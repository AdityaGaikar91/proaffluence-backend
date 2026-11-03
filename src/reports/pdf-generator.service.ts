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
  }): Promise<{
    filePath: string;
    buffer: Buffer;
    engine: 'libreoffice' | 'pdfkit-fallback';
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

    const externalPdfs = this.listExternalPdfs(groupHeadId, period);
    const externalPagesCount = externalPdfs.reduce(
      (acc, item) => acc + item.pageCount,
      0,
    );
    const totalExpectedPages = 1 + externalPagesCount;

    // Step 1: Generate unencrypted Page 1 (FY Annual Dashboard)
    let page1Buffer: Buffer | null = null;
    let engineUsed: 'libreoffice' | 'pdfkit-fallback' = 'pdfkit-fallback';

    if (workbookPath && fs.existsSync(workbookPath)) {
      try {
        await execFileAsync(
          'soffice',
          [
            '--headless',
            '--convert-to',
            'pdf:calc_pdf_Export',
            '--outdir',
            this.pdfDir,
            workbookPath,
          ],
          { timeout: 12000 },
        );
        const loOut = path.join(
          this.pdfDir,
          `${path.basename(workbookPath, '.xlsx')}.pdf`,
        );
        if (fs.existsSync(loOut)) {
          page1Buffer = fs.readFileSync(loOut);
          engineUsed = 'libreoffice';
        }
      } catch {
        this.logger.debug(
          'Headless LibreOffice (soffice) not available on host; using built-in A4 PDF engine fallback for Page 1.',
        );
      }
    }

    // If no external PDFs exist and encrypted is requested and LibreOffice wasn't used,
    // we can render Page 1 directly with native PDFKit password encryption.
    if (!page1Buffer && externalPdfs.length === 0) {
      const directBuffer = await this.renderA4DashboardWithPdfKit({
        dashboard,
        userPassword: encrypted ? password : undefined,
        totalPages: 1,
      });
      fs.writeFileSync(targetPdfPath, directBuffer);
      return {
        filePath: targetPdfPath,
        buffer: directBuffer,
        engine: 'pdfkit-fallback',
        isPasswordProtected: encrypted,
        passwordRule: `Client PAN (${password})`,
        totalMergedPages: 1,
        externalPdfsCount: 0,
      };
    }

    if (!page1Buffer) {
      page1Buffer = await this.renderA4DashboardWithPdfKit({
        dashboard,
        totalPages: totalExpectedPages,
      });
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
      isPasswordProtected: encrypted,
      passwordRule: `Client PAN (${password})`,
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
      await execFileAsync(
        'qpdf',
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
      throw new ServiceUnavailableException(
        `Cannot encrypt client PDF with PAN password: qpdf is missing or failed (${detail}). Install qpdf on the host, or use encrypted=false for internal preview only.`,
      );
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

      const pageWidth = doc.page.width - 72; // 523.28 pt
      const startX = 36;
      let y = 36;

      // 1. Header Banner
      doc.rect(startX, y, pageWidth, 48).fillAndStroke('#0F291E', '#0F291E');
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text('PROAFFLUENCE ASSOCIATES PRIVATE LIMITED', startX + 14, y + 11);
      doc
        .fillColor('#A7F3D0')
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          'AMFI Registered Mutual Fund Distributor & Private Wealth Advisory',
          startX + 14,
          y + 28,
        );
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text('FY ANNUAL - DASHBOARD :', startX + pageWidth - 180, y + 12, {
          width: 166,
          align: 'right',
        });
      doc
        .fillColor('#D1FAE5')
        .font('Helvetica')
        .fontSize(8.5)
        .text(
          `As on ${dashboard.header.toPeriod}`,
          startX + pageWidth - 180,
          y + 28,
          { width: 166, align: 'right' },
        );

      y += 58;

      // 2. Mandate Metadata Block
      doc.rect(startX, y, pageWidth, 46).fillAndStroke('#F8FAFC', '#CBD5E1');

      const metaLeft = [
        ['Group Head Name :', dashboard.header.groupHeadName || 'ABC'],
        ['Family Member Name :', dashboard.header.familyMemberName || 'All'],
        ['Category :', dashboard.header.category || 'All'],
      ];
      const metaRight = [
        ['Inception Date :', dashboard.header.inceptionDate || '05-07-2021'],
        ['From Period :', dashboard.header.fromPeriod || '05-07-2021'],
        ['To Period :', dashboard.header.toPeriod || '30-09-2026'],
      ];

      metaLeft.forEach(([label, val], idx) => {
        const rowY = y + 7 + idx * 12;
        doc
          .fillColor('#475569')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(label, startX + 10, rowY);
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(val, startX + 115, rowY);
      });

      metaRight.forEach(([label, val], idx) => {
        const rowY = y + 7 + idx * 12;
        doc
          .fillColor('#475569')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(label, startX + 280, rowY);
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(val, startX + 375, rowY);
      });

      y += 56;

      // 3. SUMMARY Table
      doc
        .fillColor('#0F291E')
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('SUMMARY :', startX, y);
      y += 14;

      const summaryCols = [
        { header: 'Financial Year', width: 120, align: 'left' as const },
        { header: 'Value As on 31/03', width: 115, align: 'right' as const },
        { header: 'New Investments', width: 115, align: 'right' as const },
        { header: 'XIRR', width: 86, align: 'right' as const },
        { header: 'Nifty 50 TRI', width: 87, align: 'right' as const },
      ];

      doc.rect(startX, y, pageWidth, 18).fillAndStroke('#E2E8F0', '#94A3B8');
      let colX = startX;
      summaryCols.forEach((col) => {
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(8)
          .text(col.header, colX + 6, y + 5, {
            width: col.width - 12,
            align: col.align,
          });
        colX += col.width;
      });
      y += 18;

      dashboard.summary.forEach((row, idx) => {
        const isTotal =
          row.isTotalRow ||
          row.financialYear.toLowerCase().includes('net investment') ||
          row.financialYear.toLowerCase().includes('total');
        const rowBg = isTotal
          ? '#F1F5F9'
          : idx % 2 === 1
            ? '#F8FAFC'
            : '#FFFFFF';

        doc.rect(startX, y, pageWidth, 16).fillAndStroke(rowBg, '#CBD5E1');
        let cx = startX;
        const fontName = isTotal ? 'Helvetica-Bold' : 'Helvetica';

        const cells = [
          row.financialYear,
          formatIndianNumber(row.valueAsOn3103),
          formatIndianNumber(row.newInvestments),
          formatPercent(row.xirr),
          formatPercent(row.nifty50Tri),
        ];

        summaryCols.forEach((col, cIdx) => {
          doc
            .fillColor('#0F172A')
            .font(fontName)
            .fontSize(8)
            .text(cells[cIdx], cx + 6, y + 4, {
              width: col.width - 12,
              align: col.align,
            });
          cx += col.width;
        });
        y += 16;
      });

      y += 16;

      // 4. Side-by-Side Tables: XIRR by Category (Left) & Asset Allocation Movement (Right)
      const halfWidth = (pageWidth - 16) / 2;
      const rightStartX = startX + halfWidth + 16;
      const sectionStartY = y;

      // Left: XIRR Table
      doc
        .fillColor('#0F291E')
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('XIRR :', startX, y);
      let leftY = y + 14;

      const xirrCols = [
        { header: 'FINANCIAL YEAR', width: 80, align: 'left' as const },
        { header: 'Portfolio', width: 44, align: 'right' as const },
        { header: 'MF', width: 42, align: 'right' as const },
        { header: 'PMS', width: 42, align: 'right' as const },
        { header: 'STOCK', width: 45, align: 'right' as const },
      ];

      doc
        .rect(startX, leftY, halfWidth, 18)
        .fillAndStroke('#E2E8F0', '#94A3B8');
      let lx = startX;
      xirrCols.forEach((col) => {
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(col.header, lx + 4, leftY + 5, {
            width: col.width - 8,
            align: col.align,
          });
        lx += col.width;
      });
      leftY += 18;

      dashboard.xirr.forEach((row, idx) => {
        const isTotal =
          row.isTotalRow ||
          row.financialYear.toLowerCase().includes('net investment') ||
          row.financialYear.toLowerCase().includes('total');
        const bg = isTotal ? '#F1F5F9' : idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
        doc.rect(startX, leftY, halfWidth, 16).fillAndStroke(bg, '#CBD5E1');
        let cx = startX;
        const vals = [
          row.financialYear,
          formatPercent(row.portfolio),
          formatPercent(row.mf),
          formatPercent(row.pms),
          formatPercent(row.stock ?? null),
        ];
        xirrCols.forEach((col, cIdx) => {
          doc
            .fillColor('#0F172A')
            .font(isTotal ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(7.5)
            .text(vals[cIdx], cx + 4, leftY + 4, {
              width: col.width - 8,
              align: col.align,
            });
          cx += col.width;
        });
        leftY += 16;
      });

      // Right: Asset Allocation Movement Table
      doc
        .fillColor('#0F291E')
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text('Asset Allocation Movement :', rightStartX, sectionStartY);
      let rightY = sectionStartY + 14;

      const allocCols = [
        { header: 'FINANCIAL YEAR', width: 103, align: 'left' as const },
        { header: 'DEBT %', width: 75, align: 'right' as const },
        { header: 'EQUITY %', width: 75, align: 'right' as const },
      ];

      doc
        .rect(rightStartX, rightY, halfWidth, 18)
        .fillAndStroke('#E2E8F0', '#94A3B8');
      let rx = rightStartX;
      allocCols.forEach((col) => {
        doc
          .fillColor('#0F172A')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text(col.header, rx + 4, rightY + 5, {
            width: col.width - 8,
            align: col.align,
          });
        rx += col.width;
      });
      rightY += 18;

      dashboard.assetAllocation.forEach((row, idx) => {
        const bg = idx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
        doc
          .rect(rightStartX, rightY, halfWidth, 16)
          .fillAndStroke(bg, '#CBD5E1');
        let cx = rightStartX;
        const vals = [
          row.financialYear,
          formatPercent(row.debtPercent),
          formatPercent(row.equityPercent),
        ];
        allocCols.forEach((col, cIdx) => {
          doc
            .fillColor('#0F172A')
            .font('Helvetica')
            .fontSize(7.5)
            .text(vals[cIdx], cx + 4, rightY + 4, {
              width: col.width - 8,
              align: col.align,
            });
          cx += col.width;
        });
        rightY += 16;
      });

      y = Math.max(leftY, rightY) + 22;

      // 5. Executive Summary Cards
      doc.rect(startX, y, halfWidth, 38).fillAndStroke('#ECFDF5', '#10B981');
      doc
        .fillColor('#065F46')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('PORTFOLIO INCEPTION RETURN', startX + 10, y + 8);
      doc
        .fillColor('#047857')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(
          formatPercent(dashboard.portfolioReturns),
          startX + halfWidth - 95,
          y + 12,
          { width: 85, align: 'right' },
        );

      doc
        .rect(rightStartX, y, halfWidth, 38)
        .fillAndStroke('#F8FAFC', '#94A3B8');
      doc
        .fillColor('#334155')
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('BENCHMARK (NIFTY 50 TRI)', rightStartX + 10, y + 8);
      doc
        .fillColor('#0F172A')
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(
          formatPercent(dashboard.benchmark),
          rightStartX + halfWidth - 95,
          y + 12,
          { width: 85, align: 'right' },
        );

      // 6. Footnote & Footer
      const footerY = doc.page.height - 58;
      doc
        .fillColor('#64748B')
        .font('Helvetica-Oblique')
        .fontSize(7.5)
        .text(
          `*Due to Portfolio Rebalancing Stallion Report is available as on ${dashboard.header.toPeriod}. Returns >= 12M use XIRR; < 12M use Point-to-Point Absolute Return.`,
          startX,
          footerY,
        );
      doc
        .fillColor('#475569')
        .font('Helvetica-Bold')
        .fontSize(7.5)
        .text(
          `Page 1 of ${totalPages} · ProAffluence Associates Private Limited · Confidential Client Mandate Report`,
          startX,
          footerY + 12,
        );

      doc.end();
    });
  }
}
