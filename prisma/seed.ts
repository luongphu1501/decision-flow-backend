import {
  DecisionOutcome,
  Prisma,
  PrismaClient,
  RequestStatus,
  ReviewerRole,
  UserRole,
  WorkflowStatus,
} from '@prisma/client';
import { expenseGraph, simulateGraph } from '../src/domain/graph';

const prisma = new PrismaClient();
const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const IDS = {
  designer: '00000000-0000-4000-8000-000000000001',
  reviewer: '00000000-0000-4000-8000-000000000002',
  requester: '00000000-0000-4000-8000-000000000003',
  teamLead: '00000000-0000-4000-8000-000000000004',
  workflow: '00000000-0000-4000-8000-000000000101',
  version: '00000000-0000-4000-8000-000000000201',
  waiting: '00000000-0000-4000-8000-000000000301',
  approved: '00000000-0000-4000-8000-000000000302',
  rejected: '00000000-0000-4000-8000-000000000303',
  decision: '00000000-0000-4000-8000-000000000401',
};

async function upsertUsers(): Promise<void> {
  const users = [
    {
      id: IDS.designer,
      name: 'Demo Designer',
      email: 'designer@demo.local',
      role: UserRole.DESIGNER,
      reviewerRole: null,
    },
    {
      id: IDS.reviewer,
      name: 'Finance Reviewer',
      email: 'reviewer@demo.local',
      role: UserRole.REVIEWER,
      reviewerRole: ReviewerRole.FINANCE,
    },
    {
      id: IDS.requester,
      name: 'Demo Requester',
      email: 'requester@demo.local',
      role: UserRole.REQUESTER,
      reviewerRole: null,
    },
    {
      id: IDS.teamLead,
      name: 'Team Lead Reviewer',
      email: 'teamlead@demo.local',
      role: UserRole.REVIEWER,
      reviewerRole: ReviewerRole.TEAM_LEAD,
    },
  ];
  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, reviewerRole: user.reviewerRole },
      create: user,
    });
  }
}

export async function seed(): Promise<void> {
  await upsertUsers();
  const graph = expenseGraph();
  await prisma.workflow.upsert({
    where: { id: IDS.workflow },
    update: {
      name: 'Expense Approval',
      description: 'Seeded expense approval workflow',
      status: WorkflowStatus.PUBLISHED,
      archivedAt: null,
    },
    create: {
      id: IDS.workflow,
      name: 'Expense Approval',
      description: 'Seeded expense approval workflow',
      status: WorkflowStatus.PUBLISHED,
      ownerId: IDS.designer,
    },
  });
  await prisma.workflowDraft.upsert({
    where: { workflowId: IDS.workflow },
    update: { graph: asJson(graph), updatedById: IDS.designer },
    create: {
      workflowId: IDS.workflow,
      revision: 1,
      graph: asJson(graph),
      updatedById: IDS.designer,
    },
  });
  await prisma.workflowVersion.upsert({
    where: { id: IDS.version },
    update: {},
    create: {
      id: IDS.version,
      workflowId: IDS.workflow,
      versionNumber: 1,
      graphSnapshot: asJson(graph),
      changeSummary: asJson({
        added: graph.nodes.length + graph.edges.length,
        removed: 0,
        changed: 0,
        positionOnly: 0,
      }),
      publishedById: IDS.designer,
    },
  });
  await prisma.workflow.update({
    where: { id: IDS.workflow },
    data: { activeVersionId: IDS.version },
  });

  const highInput = {
    amount: 6_000_000,
    department: 'Engineering',
    category: 'Equipment',
    requesterId: IDS.requester,
    description: 'Developer workstation',
  };
  const lowInput = { ...highInput, amount: 2_000_000, description: 'Office supplies' };
  const waitingRoute = simulateGraph(graph, highInput);
  const approvedRoute = simulateGraph(graph, lowInput);
  const rejectedRoute = simulateGraph(graph, highInput, { 'finance-review': 'rejected' });
  const requests = [
    { id: IDS.waiting, input: highInput, route: waitingRoute },
    { id: IDS.approved, input: lowInput, route: approvedRoute },
    { id: IDS.rejected, input: highInput, route: rejectedRoute },
  ];
  for (const item of requests) {
    const status =
      item.route.status === 'PAUSED' ? RequestStatus.WAITING_REVIEW : item.route.status;
    await prisma.request.upsert({
      where: { id: item.id },
      update: {},
      create: {
        id: item.id,
        workflowVersionId: IDS.version,
        requesterId: IDS.requester,
        formData: asJson(item.input),
        status,
        currentNodeId: item.route.currentNodeId,
        assignedReviewerRole:
          item.route.assignedReviewerRole === 'finance' ? ReviewerRole.FINANCE : null,
        routeTrace: asJson(item.route.trace),
        completedAt: item.route.status === 'PAUSED' ? null : new Date(),
      },
    });
  }
  await prisma.decision.upsert({
    where: { id: IDS.decision },
    update: {},
    create: {
      id: IDS.decision,
      requestId: IDS.rejected,
      reviewNodeId: 'finance-review',
      reviewerId: IDS.reviewer,
      outcome: DecisionOutcome.REJECTED,
      reason: 'Budget is not available for this request.',
    },
  });
  await prisma.auditEvent.createMany({
    skipDuplicates: true,
    data: [
      {
        id: '00000000-0000-4000-8000-000000000501',
        actorId: IDS.designer,
        entityType: 'WORKFLOW',
        entityId: IDS.workflow,
        action: 'WORKFLOW_CREATED',
        metadata: asJson({ seeded: true }),
      },
      {
        id: '00000000-0000-4000-8000-000000000502',
        actorId: IDS.designer,
        entityType: 'WORKFLOW',
        entityId: IDS.workflow,
        action: 'WORKFLOW_PUBLISHED',
        metadata: asJson({ versionId: IDS.version, versionNumber: 1, seeded: true }),
      },
      {
        id: '00000000-0000-4000-8000-000000000503',
        actorId: IDS.requester,
        entityType: 'REQUEST',
        entityId: IDS.waiting,
        action: 'REQUEST_SUBMITTED',
        metadata: asJson({ workflowId: IDS.workflow, seeded: true }),
      },
      {
        id: '00000000-0000-4000-8000-000000000504',
        actorId: IDS.requester,
        entityType: 'REQUEST',
        entityId: IDS.approved,
        action: 'REQUEST_COMPLETED',
        metadata: asJson({ status: 'APPROVED', seeded: true }),
      },
      {
        id: '00000000-0000-4000-8000-000000000505',
        actorId: IDS.reviewer,
        entityType: 'REQUEST',
        entityId: IDS.rejected,
        action: 'REVIEW_DECIDED',
        metadata: asJson({ outcome: 'REJECTED', seeded: true }),
      },
      {
        id: '00000000-0000-4000-8000-000000000506',
        actorId: IDS.reviewer,
        entityType: 'REQUEST',
        entityId: IDS.rejected,
        action: 'REQUEST_COMPLETED',
        metadata: asJson({ status: 'REJECTED', seeded: true }),
      },
    ],
  });
}

export async function disconnectSeedClient(): Promise<void> {
  await prisma.$disconnect();
}

if (require.main === module) {
  void seed()
    .then(() => console.log('DecisionFlow demo data is ready.'))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(disconnectSeedClient);
}
