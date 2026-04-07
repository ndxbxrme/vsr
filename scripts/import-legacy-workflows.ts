import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDbClient } from '@vitalspace/db';
import { createWorkflowTemplateRecord } from '../apps/api/src/case-service';
import { buildImportedWorkflowTemplates } from '../apps/api/src/workflow-import';
import { loadWorkspaceEnv } from '../packages/config/src/index';

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

async function main() {
  loadWorkspaceEnv(import.meta.url);

  const tenantId = readArg('--tenant-id');
  const salesPath = readArg('--sales-path');
  const lettingsPath = readArg('--lettings-path');

  if (!tenantId || !salesPath || !lettingsPath) {
    throw new Error(
      'usage: tsx scripts/import-legacy-workflows.ts --tenant-id <uuid> --sales-path <file> --lettings-path <file>',
    );
  }

  const dbClient = createDbClient(process.env.DATABASE_URL);

  try {
    const [salesJson, lettingsJson] = await Promise.all([
      readFile(resolve(process.cwd(), salesPath), 'utf8'),
      readFile(resolve(process.cwd(), lettingsPath), 'utf8'),
    ]);

    const importedTemplates = [
      ...buildImportedWorkflowTemplates({
        caseType: 'sales',
        workflows: JSON.parse(salesJson),
      }),
      ...buildImportedWorkflowTemplates({
        caseType: 'lettings',
        workflows: JSON.parse(lettingsJson),
      }),
    ];

    for (const template of importedTemplates) {
      const created = await createWorkflowTemplateRecord({
        db: dbClient.db,
        tenantId,
        key: template.key,
        name: template.name,
        side: template.side,
        caseType: template.caseType,
        status: template.status,
        isSystem: template.isSystem,
        definition: template.definition,
        stages: template.stages,
        edges: template.edges,
        actions: template.actions,
      });

      console.log(
        JSON.stringify({
          workflowTemplateId: created.workflowTemplate.id,
          key: created.workflowTemplate.key,
          versionNumber: created.workflowTemplate.versionNumber,
          side: created.workflowTemplate.side,
          stageCount: created.workflowStages.length,
          edgeCount: template.edges.length,
          actionCount: template.actions.length,
        }),
      );
    }
  } finally {
    await dbClient.client.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
