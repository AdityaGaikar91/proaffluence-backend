import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../../src/core/prisma/prisma.service';

export async function seedGroupHeadsStandalone() {
  const ghFilePath = path.join(__dirname, 'group-heads.json');
  if (!fs.existsSync(ghFilePath)) {
    console.error(`[Seed] group-heads.json not found at ${ghFilePath}`);
    return;
  }

  const rawData: any[] = JSON.parse(fs.readFileSync(ghFilePath, 'utf8'));
  console.log(`[Seed] Processing ${rawData.length} Group Head(s) from group-heads.json...`);

  let createdCount = 0;
  let updatedCount = 0;
  let memberCount = 0;

  for (const gh of rawData) {
    const { familyMembers, ...data } = gh;
    const existing = await prisma.groupHead.findUnique({
      where: { customId: data.customId },
    });

    let groupHeadId = existing?.id;

    if (!existing) {
      const created = await prisma.groupHead.create({
        data: {
          id: data.id,
          customId: data.customId,
          name: data.name,
          contactPerson: data.contactPerson,
          email: data.email,
          secondaryEmail: data.secondaryEmail,
          inceptionDate: data.inceptionDate,
          pan: data.pan,
          status: data.status,
          notes: data.notes,
          categories: data.categories,
          totalAum: data.totalAum,
          netInvestment: data.netInvestment,
        },
      });
      groupHeadId = created.id;
      createdCount++;
      console.log(`  + Created Group Head: ${data.name} (${data.customId})`);
    } else {
      await prisma.groupHead.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          contactPerson: data.contactPerson,
          email: data.email,
          secondaryEmail: data.secondaryEmail,
          inceptionDate: data.inceptionDate,
          pan: data.pan,
          status: data.status,
          notes: data.notes,
          categories: data.categories,
          totalAum: data.totalAum,
          netInvestment: data.netInvestment,
        },
      });
      updatedCount++;
      console.log(`  ~ Updated Group Head: ${data.name} (${data.customId})`);
    }

    if (groupHeadId && Array.isArray(familyMembers)) {
      for (const memberItem of familyMembers) {
        const name = typeof memberItem === 'string' ? memberItem : memberItem.name;
        const relationship = typeof memberItem === 'object' ? memberItem.relationship : undefined;
        const pan = typeof memberItem === 'object' ? memberItem.pan : undefined;

        const mem = await prisma.familyMember.findUnique({
          where: { groupHeadId_name: { groupHeadId, name } },
        });

        if (!mem) {
          await prisma.familyMember.create({
            data: { groupHeadId, name, relationship, pan },
          });
          memberCount++;
        } else if (relationship || pan) {
          await prisma.familyMember.update({
            where: { id: mem.id },
            data: { relationship, pan },
          });
        }
      }
    }
  }

  console.log(
    `[Seed] Group Heads Seed Complete: ${createdCount} created, ${updatedCount} updated, ${memberCount} new members linked.`,
  );
}

// Direct execution runner
if (require.main === module) {
  seedGroupHeadsStandalone()
    .catch((err) => {
      console.error('[Seed] Error during Group Heads seeding:', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
