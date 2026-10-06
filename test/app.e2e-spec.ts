import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ApiExceptionFilter } from '../src/common/filters/api-exception.filter';
import { expenseGraph } from '../src/domain/graph';
import { PrismaService } from '../src/prisma/prisma.service';
import { disconnectSeedClient, seed } from '../prisma/seed';

describe('DecisionFlow API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let designerToken: string;
  let requesterToken: string;
  let reviewerToken: string;
  let teamLeadToken: string;

  const login = async (email: string): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ email })
      .expect(201);
    return response.body.accessToken as string;
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.idempotencyRecord.deleteMany();
    await prisma.auditEvent.deleteMany();
    await prisma.decision.deleteMany();
    await prisma.request.deleteMany();
    await prisma.simulation.deleteMany();
    await prisma.workflow.updateMany({ data: { activeVersionId: null } });
    await prisma.workflowVersion.deleteMany();
    await prisma.workflowDraft.deleteMany();
    await prisma.workflow.deleteMany();
    await prisma.user.deleteMany();
    await seed();
    await disconnectSeedClient();
    designerToken = await login('designer@demo.local');
    requesterToken = await login('requester@demo.local');
    reviewerToken = await login('reviewer@demo.local');
    teamLeadToken = await login('teamlead@demo.local');
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces authentication and role authorization', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .send({ name: 'Unauthorized workflow' })
      .expect(401);
    const response = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set('Authorization', `Bearer ${requesterToken}`)
      .send({ name: 'Forbidden workflow' })
      .expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
  });

  it('runs the full designer, requester and reviewer lifecycle safely', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ name: 'Laptop Approval', description: 'E2E workflow' })
      .expect(201);
    const workflowId = created.body.id as string;
    expect(created.body.draft.revision).toBe(1);

    const graph = expenseGraph();
    const firstSave = await request(app.getHttpServer())
      .patch(`/api/v1/workflows/${workflowId}/draft`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ baseRevision: 1, clientSequence: 1, ...graph })
      .expect(200);
    expect(firstSave.body.revision).toBe(2);

    const save = () =>
      request(app.getHttpServer())
        .patch(`/api/v1/workflows/${workflowId}/draft`)
        .set('Authorization', `Bearer ${designerToken}`)
        .send({ baseRevision: 2, clientSequence: 2, ...graph });
    const concurrent = await Promise.all([save(), save()]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(concurrent.find((response) => response.status === 409)?.body.code).toBe(
      'DRAFT_REVISION_CONFLICT',
    );

    const validation = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${workflowId}/validate`)
      .set('Authorization', `Bearer ${designerToken}`)
      .expect(201);
    expect(validation.body).toEqual(
      expect.objectContaining({ revision: 3, valid: true, errors: 0 }),
    );

    const simulation = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${workflowId}/simulate`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({
        amount: 6_000_000,
        department: 'Engineering',
        category: 'Equipment',
        requesterId: 'demo',
      })
      .expect(201);
    expect(simulation.body).toEqual(
      expect.objectContaining({ status: 'PAUSED', currentNodeId: 'finance-review' }),
    );

    const v1 = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${workflowId}/publish`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ expectedRevision: 3 })
      .expect(201);
    expect(v1.body.versionNumber).toBe(1);

    const oldRequest = await request(app.getHttpServer())
      .post('/api/v1/requests')
      .set('Authorization', `Bearer ${requesterToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ workflowId, amount: 6_000_000, department: 'Engineering', category: 'Equipment' })
      .expect(201);
    expect(oldRequest.body.workflowVersionId).toBe(v1.body.id);
    expect(oldRequest.body.status).toBe('WAITING_REVIEW');

    graph.nodes[0]!.position.x = 40;
    await request(app.getHttpServer())
      .patch(`/api/v1/workflows/${workflowId}/draft`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ baseRevision: 3, clientSequence: 3, ...graph })
      .expect(200);
    const v2 = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${workflowId}/publish`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ expectedRevision: 4 })
      .expect(201);
    expect(v2.body.versionNumber).toBe(2);

    const oldDetail = await request(app.getHttpServer())
      .get(`/api/v1/requests/${oldRequest.body.id}`)
      .set('Authorization', `Bearer ${requesterToken}`)
      .expect(200);
    expect(oldDetail.body.workflowVersionId).toBe(v1.body.id);
    const v1Snapshot = await request(app.getHttpServer())
      .get(`/api/v1/workflows/${workflowId}/versions/${v1.body.id}`)
      .set('Authorization', `Bearer ${designerToken}`)
      .expect(200);
    expect(v1Snapshot.body.graphSnapshot.nodes[0].position.x).toBe(0);
    const diff = await request(app.getHttpServer())
      .get(`/api/v1/workflows/${workflowId}/versions/diff?base=${v1.body.id}&target=${v2.body.id}`)
      .set('Authorization', `Bearer ${designerToken}`)
      .expect(200);
    expect(diff.body.summary.positionOnly).toBe(1);

    const key = randomUUID();
    const submit = (amount = 6_000_000) =>
      request(app.getHttpServer())
        .post('/api/v1/requests')
        .set('Authorization', `Bearer ${requesterToken}`)
        .set('Idempotency-Key', key)
        .send({ workflowId, amount, department: 'Engineering', category: 'Equipment' });
    const first = await submit().expect(201);
    const replay = await submit().expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(first.body.workflowVersionId).toBe(v2.body.id);
    const reused = await submit(1_000_000).expect(409);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');

    const mismatch = await request(app.getHttpServer())
      .post(`/api/v1/requests/${oldRequest.body.id}/decision`)
      .set('Authorization', `Bearer ${teamLeadToken}`)
      .send({ outcome: 'APPROVED' })
      .expect(403);
    expect(mismatch.body.code).toBe('REVIEW_ASSIGNMENT_MISMATCH');
    const noReason = await request(app.getHttpServer())
      .post(`/api/v1/requests/${oldRequest.body.id}/decision`)
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({ outcome: 'REJECTED' })
      .expect(400);
    expect(noReason.body.code).toBe('VALIDATION_ERROR');

    const approve = () =>
      request(app.getHttpServer())
        .post(`/api/v1/requests/${oldRequest.body.id}/decision`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ outcome: 'APPROVED', reason: 'Budget is available' });
    const decisions = await Promise.all([approve(), approve()]);
    expect(decisions.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(decisions.find((response) => response.status === 201)?.body.status).toBe('APPROVED');

    const audit = await prisma.auditEvent.findMany({
      where: { entityType: 'REQUEST', entityId: oldRequest.body.id },
    });
    expect(audit.map((event) => event.action)).toEqual(
      expect.arrayContaining(['REQUEST_SUBMITTED', 'REVIEW_DECIDED', 'REQUEST_COMPLETED']),
    );
  });

  it('blocks simulation and publish for an invalid graph', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/workflows')
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ name: 'Invalid Draft' })
      .expect(201);
    const simulation = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${created.body.id}/simulate`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ amount: 1, department: 'Engineering', category: 'Other', requesterId: 'demo' })
      .expect(422);
    expect(simulation.body.code).toBe('GRAPH_INVALID');
    const publish = await request(app.getHttpServer())
      .post(`/api/v1/workflows/${created.body.id}/publish`)
      .set('Authorization', `Bearer ${designerToken}`)
      .send({ expectedRevision: 1 })
      .expect(422);
    expect(publish.body.details.issues.length).toBeGreaterThan(0);
  });
});
