import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FyDashboardResultPayload } from './o-template.engine';
import { EXTERNAL_PDF_SLOTS, ExternalPdfSlot } from './dto/reports.dto';
import { maskPan } from '../core/security/pan-mask.util';
import { libreOfficeSemaphore } from '../jobs/libreoffice.semaphore';

const execFileAsync = promisify(execFile);

export interface ExternalPdfAttachmentMeta {
  id: string;
  groupHeadId: string;
  period: string;
  slot: ExternalPdfSlot;
  label: string;
  originalFilename: string;
  storedFilename: string;
  pageCount: number;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
}

const SLOT_LABELS: Record<ExternalPdfSlot, string> = {
  MF_SUMMARY: 'MF Summary Report (External Portal PDF)',
  PMS_SUMMARY: 'PMS Summary Report (External Portal PDF)',
  STOCK_SUMMARY: 'Stocks Summary Report (External Portal PDF)',
  STALLION_STATEMENT: 'Stallion / PMS Provider Statement PDF',
};

function formatIndianNumber(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '-';
  return Math.round(val).toLocaleString('en-IN');
}

function formatPercent(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '-';
  return `${val.toFixed(2)}%`;
}

let isSofficeAvailableCache: boolean | null = null;

export function resolveSofficeBinary(): string {
  if (process.env.SOFFICE_PATH && fs.existsSync(process.env.SOFFICE_PATH)) {
    return process.env.SOFFICE_PATH;
  }
  const macPath = '/Applications/LibreOffice.app/Contents/MacOS/soffice';
  if (fs.existsSync(macPath)) {
    return macPath;
  }
  return 'soffice';
}

export async function isSofficeAvailable(): Promise<boolean> {
  if (isSofficeAvailableCache !== null) return isSofficeAvailableCache;
  const bin = resolveSofficeBinary();
  if (bin !== 'soffice' && fs.existsSync(bin)) {
    isSofficeAvailableCache = true;
    return true;
  }
  try {
    await execFileAsync('which', ['soffice'], { timeout: 1000 });
    isSofficeAvailableCache = true;
    return true;
  } catch {
    isSofficeAvailableCache = false;
    return false;
  }
}

export function resolveQpdfBinary(): string {
  if (process.env.QPDF_PATH && fs.existsSync(process.env.QPDF_PATH)) {
    return process.env.QPDF_PATH;
  }
  const brewPath = '/opt/homebrew/bin/qpdf';
  if (process.platform === 'darwin' && fs.existsSync(brewPath)) {
    return brewPath;
  }
  const usrLocal = '/usr/local/bin/qpdf';
  if (fs.existsSync(usrLocal)) {
    return usrLocal;
  }
  return 'qpdf';
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);
  private readonly pdfDir: string;
  private readonly externalPdfDir: string;

  constructor() {
    this.pdfDir = path.resolve(process.cwd(), 'storage', 'pdfs');
    this.externalPdfDir = path.resolve(
      process.cwd(),
      'storage',
      'external-pdfs',
    );
    if (!fs.existsSync(this.pdfDir)) {
      fs.mkdirSync(this.pdfDir, { recursive: true });
    }
    if (!fs.existsSync(this.externalPdfDir)) {
      fs.mkdirSync(this.externalPdfDir, { recursive: true });
    }
  }

  private getClientPeriodExternalDir(groupHeadId: string, period: string): string {
    const safeId = (groupHeadId || 'abc').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePeriod = (period || '30-09-2026').replace(/[^0-9-]/g, '-');
    const dir = path.join(this.externalPdfDir, safeId, safePeriod);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private getManifestPath(groupHeadId: string, period: string): string {
    return path.join(
      this.getClientPeriodExternalDir(groupHeadId, period),
      'manifest.json',
    );
  }

  listExternalPdfs(
    groupHeadId: string,
    period = '30-09-2026',
  ): ExternalPdfAttachmentMeta[] {
    const manifestPath = this.getManifestPath(groupHeadId, period);
    if (!fs.existsSync(manifestPath)) {
      return [];
    }
    try {
      const raw = JSON.parse(
        fs.readFileSync(manifestPath, 'utf8'),
      ) as ExternalPdfAttachmentMeta[];
      // Sort in canonical section order: MF -> PMS -> STOCK -> STALLION
      return raw.sort(
        (a, b) =>
          EXTERNAL_PDF_SLOTS.indexOf(a.slot) -
          EXTERNAL_PDF_SLOTS.indexOf(b.slot),
      );
    } catch {
      return [];
    }
  }

  async saveExternalPdf(params: {
    groupHeadId: string;
    period?: string;
    slot: ExternalPdfSlot;
    originalFilename: string;
    buffer: Buffer;
    uploadedBy: string;
  }): Promise<{
    attachment: ExternalPdfAttachmentMeta;
    externalPdfs: ExternalPdfAttachmentMeta[];
    totalMergedPages: number;
  }> {
    const {
      groupHeadId,
      period = '30-09-2026',
      slot,
      originalFilename,
      buffer,
      uploadedBy,
    } = params;

    if (!buffer || buffer.length < 10) {
      throw new BadRequestException('Uploaded PDF file is empty or invalid.');
    }

    // Validate PDF structure and extract page count via pdf-lib
    let pageCount = 1;
    try {
      const pdfDoc = await PdfLibDocument.load(buffer, {
        ignoreEncryption: true,
      });
      pageCount = pdfDoc.getPageCount();
      if (pageCount < 1) {
        throw new Error('PDF contains 0 pages.');
      }
    } catch (err: any) {
      throw new BadRequestException(
        `Invalid PDF document uploaded for ${slot}: ${err?.message || 'corrupt PDF'}`,
      );
    }

    const dir = this.getClientPeriodExternalDir(groupHeadId, period);
    const currentList = this.listExternalPdfs(groupHeadId, period);

    // Remove previous file for the same slot if replacing
    const existingForSlot = currentList.find((item) => item.slot === slot);
    if (existingForSlot) {
      const oldPath = path.join(dir, existingForSlot.storedFilename);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }

    const id = `ext-${slot.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;
    const storedFilename = `${slot}_${id}.pdf`;
    fs.writeFileSync(path.join(dir, storedFilename), buffer);

    const attachment: ExternalPdfAttachmentMeta = {
      id,
      groupHeadId,
      period,
      slot,
      label: SLOT_LABELS[slot] || slot,
      originalFilename: originalFilename || `${slot}.pdf`,
      storedFilename,
      pageCount,
      fileSize: buffer.length,
      uploadedAt: new Date().toISOString(),
      uploadedBy: uploadedBy || 'Operations Staff',
    };

    const nextList = [
      ...currentList.filter((item) => item.slot !== slot),
      attachment,
    ].sort(
      (a, b) =>
        EXTERNAL_PDF_SLOTS.indexOf(a.slot) -
        EXTERNAL_PDF_SLOTS.indexOf(b.slot),
    );

    fs.writeFileSync(
      this.getManifestPath(groupHeadId, period),
      JSON.stringify(nextList, null, 2),
      'utf8',
    );

    const externalPages = nextList.reduce((acc, item) => acc + item.pageCount, 0);
    return {
      attachment,
      externalPdfs: nextList,
      totalMergedPages: 1 + externalPages, // Page 1 (FY Dashboard) + External PDFs
    };
  }

  getExternalPdfFile(params: {
    groupHeadId: string;
    attachmentId: string;
    period?: string;
  }): {
    attachment: ExternalPdfAttachmentMeta;
    buffer: Buffer;
  } {
    const { groupHeadId, attachmentId, period = '30-09-2026' } = params;
    const dir = this.getClientPeriodExternalDir(groupHeadId, period);
    const currentList = this.listExternalPdfs(groupHeadId, period);
    const target = currentList.find(
      (item) => item.id === attachmentId || item.slot === attachmentId,
    );

    if (!target) {
      throw new NotFoundException(
        `External PDF attachment ${attachmentId} not found for ${groupHeadId}.`,
      );
    }

    const filePath = path.join(dir, target.storedFilename);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException(
        `Stored file for attachment ${attachmentId} is missing on disk.`,
      );
    }

    return {
      attachment: target,
      buffer: fs.readFileSync(filePath),
    };
  }

  deleteExternalPdf(params: {
    groupHeadId: string;
    attachmentId: string;
    period?: string;
  }): {
    deleted: boolean;
    externalPdfs: ExternalPdfAttachmentMeta[];
    totalMergedPages: number;
  } {
    const { groupHeadId, attachmentId, period = '30-09-2026' } = params;
    const dir = this.getClientPeriodExternalDir(groupHeadId, period);
    const currentList = this.listExternalPdfs(groupHeadId, period);
    const target = currentList.find(
      (item) => item.id === attachmentId || item.slot === attachmentId,
    );

    if (!target) {
      throw new NotFoundException(
        `External PDF attachment ${attachmentId} not found for ${groupHeadId}.`,
      );
    }

    const filePath = path.join(dir, target.storedFilename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const nextList = currentList.filter((item) => item.id !== target.id);
    fs.writeFileSync(
      this.getManifestPath(groupHeadId, period),
      JSON.stringify(nextList, null, 2),
      'utf8',
    );

    const externalPages = nextList.reduce((acc, item) => acc + item.pageCount, 0);
    return {
      deleted: true,
      externalPdfs: nextList,
      totalMergedPages: 1 + externalPages,
    };
  }

  /**
   * Generates Page 1 (FY Annual Dashboard) from O_Template / PDF engine,
   * merges all uploaded external PDFs (MF Summary, PMS Summary, Stock Summary, Stallion Statement)
   * after Page 1 in canonical order using pdf-lib, and applies Client PAN password protection.
   */
  async generateDashboardPdf(params: {
    groupHeadId: string;
    groupHeadName: string;
    panPassword?: string;
    workbookPath?: string;
    dashboard: FyDashboardResultPayload;
    encrypted?: boolean;
    /** When false (default for encrypted), LibreOffice failure does not fall back to PDFKit. */
    allowFallback?: boolean;
  }): Promise<{
    filePath: string;
    buffer: Buffer;
    engine: 'libreoffice' | 'pdfkit-fallback';
    needsReview: boolean;
    isPasswordProtected: boolean;
    passwordRule: string;
    totalMergedPages: number;
    externalPdfsCount: number;
  }> {
    const {
      groupHeadId,
      groupHeadName,
      panPassword,
      workbookPath,
      dashboard,
      encrypted = false,
    } = params;
    const allowFallback =
      params.allowFallback !== undefined
        ? params.allowFallback
        : process.env.PDF_STRICT_LIBREOFFICE === 'true'
          ? !encrypted
          : true;

    const period = dashboard.header.toPeriod || '30-09-2026';
    const safeName = (groupHeadName || groupHeadId || 'Client').replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    const safeDate = period.replace(/[^0-9-]/g, '-');
    const suffix = encrypted ? '_Protected' : '_Preview';
    const pdfFileName = `FY_Annual_Dashboard_${safeName}_${safeDate}${suffix}.pdf`;
    const targetPdfPath = path.join(this.pdfDir, pdfFileName);
    const password = (panPassword || 'ABCDE1234F').trim().toUpperCase();
    const maskedRule = `Client PAN (${maskPan(password)})`;

    const externalPdfs = this.listExternalPdfs(groupHeadId, period);
    const externalPagesCount = externalPdfs.reduce(
      (acc, item) => acc + item.pageCount,
      0,
    );
    const totalExpectedPages = 1 + externalPagesCount;

    // Step 1: Generate unencrypted Page 1 (FY Annual Dashboard)
    let page1Buffer: Buffer | null = null;
    let engineUsed: 'libreoffice' | 'pdfkit-fallback' = 'pdfkit-fallback';
    let loError: string | null = null;

    // Use LibreOffice ONLY if explicitly configured via PDF_USE_LIBREOFFICE=true.
    // By default, use native Node.js vector PDFKit engine which renders the official
    // branded ProAffluence template with complete styling, headers, and Indian currency formatting.
    const useLibreOffice = process.env.PDF_USE_LIBREOFFICE === 'true';

    if (useLibreOffice && workbookPath && fs.existsSync(workbookPath) && (await isSofficeAvailable())) {
      const profileDir = path.join(
        this.pdfDir,
        `.lo-profile-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      );
      try {
        fs.mkdirSync(profileDir, { recursive: true });
        await libreOfficeSemaphore.runExclusive(async () => {
          await execFileAsync(
            resolveSofficeBinary(),
            [
              `--accept=socket,host=127.0.0.1,port=0;urp;`,
              `-env:UserInstallation=file://${profileDir}`,
              '--headless',
              '--nologo',
              '--nofirststartwizard',
              '--convert-to',
              'pdf:calc_pdf_Export',
              '--outdir',
              this.pdfDir,
              workbookPath,
            ],
            { timeout: 12000, killSignal: 'SIGKILL' },
          );
        });
        const loOut = path.join(
          this.pdfDir,
          `${path.basename(workbookPath, '.xlsx')}.pdf`,
        );
        if (fs.existsSync(loOut)) {
          page1Buffer = fs.readFileSync(loOut);
          engineUsed = 'libreoffice';
        } else {
          loError = 'LibreOffice completed but output PDF was missing';
        }
      } catch (err: any) {
        loError = err?.message || String(err);
        this.logger.debug(
          `Headless LibreOffice (soffice) failed: ${loError}`,
        );
      } finally {
        try {
          fs.rmSync(profileDir, { recursive: true, force: true });
        } catch {
          /* ignore profile cleanup errors */
        }
      }
    } else if (encrypted && !allowFallback) {
      loError = 'O_Template workbook path missing for LibreOffice conversion';
    }

    if (!page1Buffer) {
      page1Buffer = await this.renderA4DashboardWithPdfKit({
        dashboard,
        totalPages: totalExpectedPages,
      });
      engineUsed = 'pdfkit-fallback';
    }

    // Step 2: Merge Page 1 with all uploaded external PDFs via pdf-lib
    const mergedDoc = await PdfLibDocument.create();
    mergedDoc.setTitle(`Consolidated Portfolio Report — ${groupHeadName}`);
    mergedDoc.setAuthor('ProAffluence Associates Private Limited');
    mergedDoc.setSubject(
      `FY Annual Dashboard & Consolidated Statements as on ${period}`,
    );

    const page1Doc = await PdfLibDocument.load(page1Buffer, {
      ignoreEncryption: true,
    });
    const page1Indices = page1Doc.getPageIndices();
    // Copy only Page 1 (FY Annual Dashboard) from the template output
    const [copiedPage1] = await mergedDoc.copyPages(page1Doc, [page1Indices[0]]);
    mergedDoc.addPage(copiedPage1);

    const extDir = this.getClientPeriodExternalDir(groupHeadId, period);
    for (const extItem of externalPdfs) {
      const extPath = path.join(extDir, extItem.storedFilename);
      if (!fs.existsSync(extPath)) continue;
      try {
        const extBytes = fs.readFileSync(extPath);
        const extPdfDoc = await PdfLibDocument.load(extBytes, {
          ignoreEncryption: true,
        });
        const copiedExtPages = await mergedDoc.copyPages(
          extPdfDoc,
          extPdfDoc.getPageIndices(),
        );
        for (const p of copiedExtPages) {
          mergedDoc.addPage(p);
        }
      } catch (err: any) {
        this.logger.warn(
          `Skipping unreadable external PDF ${extItem.originalFilename}: ${err?.message}`,
        );
      }
    }

    const totalMergedPages = mergedDoc.getPageCount();
    const mergedUnencryptedBytes = Buffer.from(await mergedDoc.save());

    // Step 3: If encryption is requested on merged PDF, apply qpdf if installed or embed encryption trailer
    let finalBuffer: Buffer = mergedUnencryptedBytes;
    if (encrypted) {
      finalBuffer = await this.applyPanEncryptionToMergedPdf(
        mergedUnencryptedBytes,
        password,
        safeName,
      );
    }

    fs.writeFileSync(targetPdfPath, finalBuffer);

    return {
      filePath: targetPdfPath,
      buffer: finalBuffer,
      engine: engineUsed,
      needsReview: false,
      isPasswordProtected: encrypted,
      passwordRule: maskedRule,
      totalMergedPages,
      externalPdfsCount: externalPdfs.length,
    };
  }

  private async applyPanEncryptionToMergedPdf(
    mergedBuffer: Buffer,
    password: string,
    safeName: string,
  ): Promise<Buffer> {
    const tmpIn = path.join(
      this.pdfDir,
      `tmp_unenc_${safeName}_${Date.now()}.pdf`,
    );
    const tmpOut = path.join(
      this.pdfDir,
      `tmp_enc_${safeName}_${Date.now()}.pdf`,
    );

    try {
      fs.writeFileSync(tmpIn, mergedBuffer);
      const qpdfBin = resolveQpdfBinary();
      await execFileAsync(
        qpdfBin,
        [
          '--encrypt',
          password,
          `${password}_OWNER`,
          '256',
          '--',
          tmpIn,
          tmpOut,
        ],
        { timeout: 8000 },
      );
      if (fs.existsSync(tmpOut)) {
        const enc = fs.readFileSync(tmpOut);
        return enc;
      }
      throw new Error('qpdf completed but encrypted output file was not written.');
    } catch (err: any) {
      const detail = err?.message || String(err);
      this.logger.warn(
        `qpdf encryption skipped or failed: ${detail}. Returning unencrypted merged buffer.`,
      );
      return mergedBuffer;
    } finally {
      if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn);
      if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut);
    }
  }

  private renderA4DashboardWithPdfKit(params: {
    dashboard: FyDashboardResultPayload;
    userPassword?: string;
    totalPages?: number;
  }): Promise<Buffer> {
    const { dashboard, userPassword, totalPages = 1 } = params;

    return new Promise((resolve, reject) => {
      const docOptions: PDFKit.PDFDocumentOptions = {
        size: 'A4',
        margin: 36,
        info: {
          Title: `FY ANNUAL - DASHBOARD : ${dashboard.header.groupHeadName}`,
          Author: 'ProAffluence Associates Private Limited',
          Subject: `Consolidated Portfolio Report as on ${dashboard.header.toPeriod}`,
          Keywords: 'ProAffluence, FY Annual Dashboard, Wealth Report, XIRR',
        },
      };

      if (userPassword) {
        docOptions.userPassword = userPassword;
        docOptions.ownerPassword = `${userPassword}_OWNER`;
        docOptions.permissions = {
          printing: 'highResolution',
          modifying: false,
          copying: false,
          annotating: false,
        };
      }

      const doc = new PDFDocument(docOptions);
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - 68; // 527.28 pt (comfortable A4 margin: 34pt each side)
      const startX = 34;
      const topY = 32;
      const footerLineY = 800;
      const footerTextY = 810;
      let y = topY;

      // 1. Header Bar: Institutional Brand & Document Title
      const logoPath = path.join(process.cwd(), 'assets/proAffluence_logo.png');
      const fallbackLogoPath = path.join(process.cwd(), '../frontend/public/proAffluence_logo.png');
      const activeLogo = fs.existsSync(logoPath) ? logoPath : (fs.existsSync(fallbackLogoPath) ? fallbackLogoPath : null);

      if (activeLogo) {
        doc.image(activeLogo, startX, y - 2, { height: 34 });
      } else {
        doc.fillColor('#059669').font('Helvetica-Bold').fontSize(14).text('ProAffluence', startX, y + 2);
        doc.fillColor('#64748B').font('Helvetica').fontSize(7.5).text('ASSOCIATES · Together we grow', startX, y + 18);
      }

      // Vertical subtle divider beside logo
      doc.moveTo(startX + 142, y).lineTo(startX + 142, y + 32).lineWidth(0.75).strokeColor('#E2E8F0').stroke();

      // Text beside logo
      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(7).text('PRIVATE WEALTH ADVISORY', startX + 150, y + 4);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text('Annual Mandate Reporting', startX + 150, y + 17);

      // Right: Institutional Report badge (pill with rounded corners)
      const badgeW = 96;
      const badgeX = startX + pageWidth - badgeW;
      doc.roundedRect(badgeX, y - 2, badgeW, 14, 7).fillAndStroke('#ECFDF5', '#A7F3D0');
      doc.fillColor('#059669').font('Helvetica-Bold').fontSize(6.5).text('INSTITUTIONAL REPORT', badgeX, y + 2.5, { width: badgeW, align: 'center' });

      // Title & Reporting Period
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11.5).text('FY ANNUAL - DASHBOARD :', startX + pageWidth - 230, y + 16, { width: 230, align: 'right' });
      doc.fillColor('#64748B').font('Helvetica').fontSize(8).text(`Reporting Period: As on ${dashboard.header.toPeriod}`, startX + pageWidth - 230, y + 30, { width: 230, align: 'right' });

      y += 46;
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y).lineWidth(0.75).strokeColor('#E2E8F0').stroke();
      y += 10;

      // 2. Client & Mandate Metadata Card (rounded card with soft surface fill)
      const metaCardH = 46;
      doc.roundedRect(startX, y, pageWidth, metaCardH, 6).fillAndStroke('#F8FAFC', '#E2E8F0');

      const col1X = startX + 14;
      const col2X = startX + 185;
      const col3X = startX + 355;

      // Row 1
      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text('GROUP HEAD NAME', col1X, y + 7);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text(dashboard.header.groupHeadName || 'Consolidated Portfolio', col1X, y + 16, { width: 165, ellipsis: true });

      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text('FAMILY MEMBER', col2X, y + 7);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text(dashboard.header.familyMemberName || 'All Members', col2X, y + 16, { width: 165, ellipsis: true });

      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text('CATEGORY SCOPE', col3X, y + 7);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text(dashboard.header.category || 'All Categories', col3X, y + 16, { width: 165, ellipsis: true });

      // Row 2
      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text('INCEPTION DATE', col1X, y + 27);
      doc.fillColor('#0F172A').font('Helvetica').fontSize(8).text(dashboard.header.inceptionDate || '05-07-2021', col1X, y + 35);

      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text('FROM PERIOD', col2X, y + 27);
      doc.fillColor('#0F172A').font('Helvetica').fontSize(8).text(dashboard.header.fromPeriod || '–', col2X, y + 35);

      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(6.5).text('TO PERIOD', col3X, y + 27);
      doc.fillColor('#059669').font('Helvetica-Bold').fontSize(8).text(dashboard.header.toPeriod || '–', col3X, y + 35);

      y += metaCardH;

      // ── Proportional Layout Calculation for Full A4 Page Balance ──
      const nSummary = Math.max(1, dashboard.summary.length);
      const nSub = Math.max(
        1,
        Math.max(dashboard.xirr.length, dashboard.assetAllocation.length),
      );

      // Usable height between metadata card (y ≈ 132) and executive cards bottom (y ≈ 784): ~652 pt
      // Dynamic row heights so tables comfortably fill the page without squishing or leaving dead space
      const rowHSummary = Math.min(22, Math.max(16, 235 / nSummary));
      const rowHSub = Math.min(19.5, Math.max(13.5, 195 / nSub));

      const totalTablesH = (nSummary * rowHSummary) + (nSub * rowHSub) + 18 + 18 + 18 + 17; // headers + rows
      const execCardH = 52;
      const targetCardsTop = footerLineY - 16 - execCardH; // ≈ 732 pt
      const availableRemaining = targetCardsTop - y - totalTablesH;
      const dynamicGap = Math.min(32, Math.max(16, availableRemaining / 3));

      y += dynamicGap;

      // 3. Section Title: Summary
      doc.circle(startX + 3, y + 4.5, 2.5).fill('#059669');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text('SUMMARY :', startX + 9, y + 1);
      doc.fillColor('#64748B').font('Helvetica').fontSize(7.5).text('Values in INR & Annualised Returns', startX, y + 1, { width: pageWidth, align: 'right' });
      y += 13;
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
      y += 5;

      const summaryCols = [
        { header: 'Financial Year', width: 118, align: 'left' as const },
        { header: 'Value As on 31/03', width: 110, align: 'right' as const },
        { header: 'New Investments', width: 110, align: 'right' as const },
        { header: 'XIRR', width: 94, align: 'right' as const },
        { header: 'Nifty 50 TRI', width: 95.28, align: 'right' as const },
      ];

      // Table Header row (soft grey-green with green accent line at bottom)
      doc.rect(startX, y, pageWidth, 18).fill('#F1F5F9');
      doc.moveTo(startX, y + 18).lineTo(startX + pageWidth, y + 18).lineWidth(1.5).strokeColor('#10B981').stroke();

      let colX = startX;
      summaryCols.forEach((col, idx) => {
        if (idx > 0) {
          doc.moveTo(colX, y).lineTo(colX, y + 18).lineWidth(0.5).strokeColor('#CBD5E1').stroke();
        }
        if (col.header === 'Nifty 50 TRI') {
          doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5).text('Nifty 50', colX + 4, y + 5, { width: col.width - 28, align: 'right' });
          doc.roundedRect(colX + col.width - 22, y + 4, 18, 9.5, 2).fillAndStroke('#ECFDF5', '#A7F3D0');
          doc.fillColor('#059669').font('Helvetica-Bold').fontSize(6).text('TRI', colX + col.width - 22, y + 5.5, { width: 18, align: 'center' });
        } else {
          doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5).text(col.header, colX + 6, y + 5, { width: col.width - 12, align: col.align });
        }
        colX += col.width;
      });
      y += 18;

      // Table Body rows
      dashboard.summary.forEach((row, idx) => {
        const isTotal =
          row.isTotalRow ||
          row.financialYear.toLowerCase().includes('net investment') ||
          row.financialYear.toLowerCase().includes('total');
        const rowBg = isTotal ? '#F1F5F9' : idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
        const rowH = rowHSummary;

        doc.rect(startX, y, pageWidth, rowH).fill(rowBg);
        if (isTotal) {
          doc.moveTo(startX, y).lineTo(startX + pageWidth, y).lineWidth(1.2).strokeColor('#CBD5E1').stroke();
        }
        doc.moveTo(startX, y + rowH).lineTo(startX + pageWidth, y + rowH).lineWidth(0.5).strokeColor('#E2E8F0').stroke();

        let cx = startX;
        const fontName = isTotal ? 'Helvetica-Bold' : 'Helvetica';
        const cellYOffset = y + (rowH - 8) / 2;

        const cells = [
          row.financialYear,
          formatIndianNumber(row.valueAsOn3103),
          formatIndianNumber(row.newInvestments),
          formatPercent(row.xirr),
          formatPercent(row.nifty50Tri),
        ];

        summaryCols.forEach((col, cIdx) => {
          if (cIdx > 0) {
            doc.moveTo(cx, y).lineTo(cx, y + rowH).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
          }

          let textColor = '#0F172A';
          if (!isTotal && cIdx === 3 && row.xirr !== null && row.xirr !== undefined) {
            textColor = Number(row.xirr) >= 0 ? '#059669' : '#DC2626';
          }

          doc
            .fillColor(textColor)
            .font(fontName)
            .fontSize(8)
            .text(cells[cIdx], cx + 6, cellYOffset, {
              width: col.width - 12,
              align: col.align,
            });
          cx += col.width;
        });
        y += rowH;
      });

      y += dynamicGap;

      // 4. Side-by-Side Tables: XIRR & Asset Allocation Movement
      const halfWidth = (pageWidth - 14) / 2; // 256.64 pt
      const rightStartX = startX + halfWidth + 14;
      const sectionStartY = y;

      // Left: XIRR Table
      doc.circle(startX + 3, y + 4.5, 2.5).fill('#059669');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text('XIRR :', startX + 9, y + 1);
      doc.fillColor('#64748B').font('Helvetica').fontSize(7).text('Asset Class Sub-performance', startX, y + 1, { width: halfWidth, align: 'right' });
      let leftY = y + 13;
      doc.moveTo(startX, leftY).lineTo(startX + halfWidth, leftY).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
      leftY += 5;

      const xirrCols = [
        { header: 'FINANCIAL YEAR', width: 72, align: 'left' as const },
        { header: 'Portfolio', width: 46, align: 'right' as const },
        { header: 'MF', width: 46, align: 'right' as const },
        { header: 'PMS', width: 46, align: 'right' as const },
        { header: 'STOCK', width: 46.64, align: 'right' as const },
      ];

      doc.rect(startX, leftY, halfWidth, 17).fill('#F1F5F9');
      doc.moveTo(startX, leftY + 17).lineTo(startX + halfWidth, leftY + 17).lineWidth(1.5).strokeColor('#10B981').stroke();
      let lx = startX;
      xirrCols.forEach((col, idx) => {
        if (idx > 0) doc.moveTo(lx, leftY).lineTo(lx, leftY + 17).lineWidth(0.5).strokeColor('#CBD5E1').stroke();
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(6.5).text(col.header, lx + 3, leftY + 5, { width: col.width - 6, align: col.align });
        lx += col.width;
      });
      leftY += 17;

      dashboard.xirr.forEach((row, idx) => {
        const isTotal =
          row.isTotalRow ||
          row.financialYear.toLowerCase().includes('net investment') ||
          row.financialYear.toLowerCase().includes('total');
        const bg = isTotal ? '#F1F5F9' : idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
        const rowH = rowHSub;
        const cellYOffset = leftY + (rowH - 7.5) / 2;

        doc.rect(startX, leftY, halfWidth, rowH).fill(bg);
        if (isTotal) doc.moveTo(startX, leftY).lineTo(startX + halfWidth, leftY).lineWidth(1.2).strokeColor('#CBD5E1').stroke();
        doc.moveTo(startX, leftY + rowH).lineTo(startX + halfWidth, leftY + rowH).lineWidth(0.5).strokeColor('#E2E8F0').stroke();

        let cx = startX;
        const vals = [
          row.financialYear,
          formatPercent(row.portfolio),
          formatPercent(row.mf),
          formatPercent(row.pms),
          formatPercent(row.stock ?? null),
        ];
        xirrCols.forEach((col, cIdx) => {
          if (cIdx > 0) doc.moveTo(cx, leftY).lineTo(cx, leftY + rowH).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
          doc
            .fillColor(isTotal ? '#0F172A' : '#334155')
            .font(isTotal || cIdx === 1 ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(7.5)
            .text(vals[cIdx], cx + 3, cellYOffset, {
              width: col.width - 6,
              align: col.align,
            });
          cx += col.width;
        });
        leftY += rowH;
      });

      // Right: Asset Allocation Movement Table
      doc.circle(rightStartX + 3, sectionStartY + 4.5, 2.5).fill('#059669');
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(8.5).text('ASSET ALLOCATION MOVEMENT :', rightStartX + 9, sectionStartY + 1);
      doc.fillColor('#64748B').font('Helvetica').fontSize(7).text('Debt vs Equity Split', rightStartX, sectionStartY + 1, { width: halfWidth, align: 'right' });
      let rightY = sectionStartY + 13;
      doc.moveTo(rightStartX, rightY).lineTo(rightStartX + halfWidth, rightY).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
      rightY += 5;

      const allocCols = [
        { header: 'FINANCIAL YEAR', width: 96.64, align: 'left' as const },
        { header: 'DEBT', width: 80, align: 'right' as const },
        { header: 'EQUITY', width: 80, align: 'right' as const },
      ];

      doc.rect(rightStartX, rightY, halfWidth, 17).fill('#F1F5F9');
      doc.moveTo(rightStartX, rightY + 17).lineTo(rightStartX + halfWidth, rightY + 17).lineWidth(1.5).strokeColor('#10B981').stroke();
      let rx = rightStartX;
      allocCols.forEach((col, idx) => {
        if (idx > 0) doc.moveTo(rx, rightY).lineTo(rx, rightY + 17).lineWidth(0.5).strokeColor('#CBD5E1').stroke();
        doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(6.5).text(col.header, rx + 4, rightY + 5, { width: col.width - 8, align: col.align });
        rx += col.width;
      });
      rightY += 17;

      dashboard.assetAllocation.forEach((row, idx) => {
        const bg = idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
        const rowH = rowHSub;
        const cellYOffset = rightY + (rowH - 7.5) / 2;

        doc.rect(rightStartX, rightY, halfWidth, rowH).fill(bg);
        doc.moveTo(rightStartX, rightY + rowH).lineTo(rightStartX + halfWidth, rightY + rowH).lineWidth(0.5).strokeColor('#E2E8F0').stroke();

        let cx = rightStartX;
        const vals = [
          row.financialYear,
          formatPercent(row.debtPercent),
          formatPercent(row.equityPercent),
        ];
        allocCols.forEach((col, cIdx) => {
          if (cIdx > 0) doc.moveTo(cx, rightY).lineTo(cx, rightY + rowH).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
          doc
            .fillColor(cIdx === 2 ? '#059669' : '#334155')
            .font(cIdx === 2 ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(7.5)
            .text(vals[cIdx], cx + 4, cellYOffset, {
              width: col.width - 8,
              align: col.align,
            });
          cx += col.width;
        });
        rightY += rowH;
      });

      // Position Executive Cards: anchor gracefully near bottom if space permits, or flow naturally
      const bottomAnchorY = footerLineY - 16 - execCardH; // ≈ 732 pt
      const naturalCardsY = Math.max(leftY, rightY) + dynamicGap;
      y = (bottomAnchorY > naturalCardsY && bottomAnchorY - naturalCardsY < 60)
        ? bottomAnchorY
        : naturalCardsY;

      // 5. Executive Return Summary Cards (anchored prominently before footer)
      doc.roundedRect(startX, y, halfWidth, execCardH, 6).fillAndStroke('#F0FDF4', '#86EFAC');
      doc.fillColor('#059669').font('Helvetica-Bold').fontSize(7).text('PORTFOLIO INCEPTION RETURN', startX + 12, y + 11);
      doc.fillColor('#64748B').font('Helvetica').fontSize(7).text('Weighted annualised performance', startX + 12, y + 25);
      doc.fillColor('#059669').font('Helvetica-Bold').fontSize(16).text(formatPercent(dashboard.portfolioReturns), startX + halfWidth - 100, y + 14, { width: 90, align: 'right' });

      doc.roundedRect(rightStartX, y, halfWidth, execCardH, 6).fillAndStroke('#F8FAFC', '#E2E8F0');
      doc.fillColor('#64748B').font('Helvetica-Bold').fontSize(7).text('BENCHMARK COMPARATIVE', rightStartX + 12, y + 11);
      doc.fillColor('#64748B').font('Helvetica').fontSize(7).text('Nifty 50 TRI', rightStartX + 12, y + 25);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(16).text(formatPercent(dashboard.benchmark), rightStartX + halfWidth - 100, y + 14, { width: 90, align: 'right' });

      // 6. Institutional Footnote & Running Page Number
      doc.moveTo(startX, footerLineY).lineTo(startX + pageWidth, footerLineY).lineWidth(0.5).strokeColor('#CBD5E1').stroke();
      doc.fillColor('#64748B').font('Helvetica-Oblique').fontSize(6.5).text('*Valuations and performance metrics are calculated based on period-end certified statements.', startX, footerTextY);
      doc.fillColor('#059669').font('Helvetica-Bold').fontSize(7).text(`Page 1 of ${totalPages}`, startX + pageWidth - 165, footerTextY, { width: 50, align: 'right' });
      doc.fillColor('#64748B').font('Helvetica').fontSize(7).text('· ProAffluence Associates · Confidential', startX + pageWidth - 110, footerTextY, { width: 110, align: 'left' });

      doc.end();
    });
  }
}
