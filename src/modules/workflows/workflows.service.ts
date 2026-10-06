import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, UserRole, WorkflowStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiException } from '../../common/errors/api.exception';
import {
  diffGraphs,
  simulateGraph,
  SimulationDomainError,
  WorkflowGraph,
  validateGraph,
} from '../../domain/graph';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateWorkflowDto,
  ListWorkflowsQueryDto,
  PublishWorkflowDto,
  SaveDraftDto,
  SimulateWorkflowDto,
} from './workflows.dto';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const graphFrom = (value: Prisma.JsonValue): WorkflowGraph => value as unknown as WorkflowGraph;

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  private async owned(id: string, user: AuthUser) {
    const workflow = await this.prisma.workflow.findUnique({ where: { id } });
    if (!workflow || workflow.archivedAt) {
      throw new ApiException('WORKFLOW_NOT_FOUND', 'Workflow was not found.', HttpStatus.NOT_FOUND);
    }
    if (workflow.ownerId !== user.id) {
      throw new ApiException(
        'PERMISSION_DENIED',
        'Only the workflow owner can perform this action.',
        HttpStatus.FORBIDDEN,
      );
    }
    return workflow;
  }

  async create(dto: CreateWorkflowDto, user: AuthUser) {
    const initialGraph: WorkflowGraph = {
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: 'Start',
          position: { x: 80, y: 120 },
          config: { displayName: 'Start' },
        },
      ],
      edges: [],
    };
    return this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflow.create({
        data: {
          name: dto.name.trim(),
          description: dto.description?.trim(),
          ownerId: user.id,
          draft: { create: { revision: 1, graph: json(initialGraph), updatedById: user.id } },
        },
        include: { draft: true, owner: { select: { id: true, name: true, email: true } } },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          entityType: 'WORKFLOW',
          entityId: workflow.id,
          action: 'WORKFLOW_CREATED',
          metadata: json({ revision: 1 }),
        },
      });
      return workflow;
    });
  }

  async list(query: ListWorkflowsQueryDto, user: AuthUser) {
    const where: Prisma.WorkflowWhereInput = {
      ...(user.role === UserRole.DESIGNER
        ? { ownerId: user.id }
        : { status: WorkflowStatus.PUBLISHED, archivedAt: null }),
      ...(query.status && user.role === UserRole.DESIGNER ? { status: query.status } : {}),
      ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workflow.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { [query.sort]: query.direction },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          activeVersion: { select: { id: true, versionNumber: true, publishedAt: true } },
          draft: { select: { revision: true, updatedAt: true } },
        },
      }),
      this.prisma.workflow.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(id: string, user: AuthUser) {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        activeVersion: { select: { id: true, versionNumber: true, publishedAt: true } },
        draft: user.role === UserRole.DESIGNER ? true : false,
      },
    });
    if (!workflow || workflow.archivedAt)
      throw new ApiException('WORKFLOW_NOT_FOUND', 'Workflow was not found.', HttpStatus.NOT_FOUND);
    if (user.role === UserRole.DESIGNER && workflow.ownerId !== user.id) {
      throw new ApiException(
        'PERMISSION_DENIED',
        'You do not own this workflow.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.role !== UserRole.DESIGNER && workflow.status !== WorkflowStatus.PUBLISHED) {
      throw new ApiException('WORKFLOW_NOT_FOUND', 'Workflow was not found.', HttpStatus.NOT_FOUND);
    }
    return workflow;
  }

  async getDraft(id: string, user: AuthUser) {
    await this.owned(id, user);
    const draft = await this.prisma.workflowDraft.findUnique({ where: { workflowId: id } });
    if (!draft)
      throw new ApiException(
        'WORKFLOW_NOT_FOUND',
        'Workflow draft was not found.',
        HttpStatus.NOT_FOUND,
      );
    return draft;
  }

  async saveDraft(id: string, dto: SaveDraftDto, user: AuthUser) {
    await this.owned(id, user);
    const graph: WorkflowGraph = { nodes: dto.nodes as any, edges: dto.edges as any };
    const graphHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowDraft.updateMany({
        where: { workflowId: id, revision: dto.baseRevision },
        data: {
          graph: json(graph),
          viewport: dto.viewport ? json(dto.viewport) : Prisma.JsonNull,
          updatedById: user.id,
          revision: { increment: 1 },
        },
      });
      if (updated.count === 0) {
        const latest = await tx.workflowDraft.findUniqueOrThrow({
          where: { workflowId: id },
          select: { revision: true },
        });
        return { conflict: latest.revision } as const;
      }
      const draft = await tx.workflowDraft.findUniqueOrThrow({ where: { workflowId: id } });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          entityType: 'WORKFLOW',
          entityId: id,
          action: 'DRAFT_UPDATED',
          metadata: json({
            revision: draft.revision,
            clientSequence: dto.clientSequence,
            graphHash,
          }),
        },
      });
      return { draft } as const;
    });
    if ('conflict' in result) {
      await this.prisma.auditEvent.create({
        data: {
          actorId: user.id,
          entityType: 'WORKFLOW',
          entityId: id,
          action: 'DRAFT_REVISION_CONFLICT',
          metadata: json({ baseRevision: dto.baseRevision, latestRevision: result.conflict }),
        },
      });
      throw new ApiException(
        'DRAFT_REVISION_CONFLICT',
        `Draft has changed since revision ${dto.baseRevision}.`,
        HttpStatus.CONFLICT,
        { baseRevision: dto.baseRevision, latestRevision: result.conflict },
      );
    }
    return {
      revision: result.draft.revision,
      clientSequence: dto.clientSequence,
      updatedAt: result.draft.updatedAt,
      graphHash,
    };
  }

  async validate(id: string, user: AuthUser) {
    const draft = await this.getDraft(id, user);
    const result = validateGraph(graphFrom(draft.graph));
    await this.prisma.auditEvent.create({
      data: {
        actorId: user.id,
        entityType: 'WORKFLOW',
        entityId: id,
        action: 'VALIDATION_REQUESTED',
        metadata: json({
          revision: draft.revision,
          valid: result.valid,
          errors: result.errors,
          warnings: result.warnings,
        }),
      },
    });
    return { revision: draft.revision, ...result };
  }

  async simulate(id: string, dto: SimulateWorkflowDto, user: AuthUser) {
    const draft = await this.getDraft(id, user);
    const validation = validateGraph(graphFrom(draft.graph));
    if (!validation.valid) {
      throw new ApiException(
        'GRAPH_INVALID',
        'Workflow graph contains validation errors.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        { issues: validation.issues },
      );
    }
    try {
      const input = {
        amount: dto.amount,
        department: dto.department,
        category: dto.category,
        requesterId: dto.requesterId,
        description: dto.description,
      };
      const result = simulateGraph(graphFrom(draft.graph), input, dto.fixtureDecisions ?? {});
      const simulation = await this.prisma.$transaction(async (tx) => {
        const created = await tx.simulation.create({
          data: {
            workflowId: id,
            draftRevision: draft.revision,
            input: json(input),
            status: result.status,
            trace: json(result.trace),
            createdById: user.id,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorId: user.id,
            entityType: 'WORKFLOW',
            entityId: id,
            action: 'SIMULATION_EXECUTED',
            metadata: json({
              simulationId: created.id,
              revision: draft.revision,
              status: result.status,
            }),
          },
        });
        return created;
      });
      return { id: simulation.id, draftRevision: draft.revision, ...result };
    } catch (error) {
      if (error instanceof SimulationDomainError) {
        throw new ApiException(
          'SIMULATION_FAILED',
          error.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
          { reason: error.code },
        );
      }
      throw error;
    }
  }

  async publish(id: string, dto: PublishWorkflowDto, user: AuthUser) {
    await this.owned(id, user);
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const draft = await tx.workflowDraft.findUniqueOrThrow({ where: { workflowId: id } });
          if (draft.revision !== dto.expectedRevision) {
            throw new ApiException(
              'DRAFT_REVISION_CONFLICT',
              'Draft revision does not match expectedRevision.',
              HttpStatus.CONFLICT,
              {
                baseRevision: dto.expectedRevision,
                latestRevision: draft.revision,
              },
            );
          }
          const graph = graphFrom(draft.graph);
          const validation = validateGraph(graph);
          if (!validation.valid) {
            throw new ApiException(
              'GRAPH_INVALID',
              'Workflow graph contains validation errors.',
              HttpStatus.UNPROCESSABLE_ENTITY,
              { issues: validation.issues },
            );
          }
          const latest = await tx.workflowVersion.findFirst({
            where: { workflowId: id },
            orderBy: { versionNumber: 'desc' },
          });
          const summary =
            dto.changeSummary ??
            (latest
              ? diffGraphs(graphFrom(latest.graphSnapshot), graph).summary
              : {
                  added: graph.nodes.length + graph.edges.length,
                  removed: 0,
                  changed: 0,
                  positionOnly: 0,
                });
          const version = await tx.workflowVersion.create({
            data: {
              workflowId: id,
              versionNumber: (latest?.versionNumber ?? 0) + 1,
              graphSnapshot: json(graph),
              changeSummary: json(summary),
              publishedById: user.id,
            },
          });
          await tx.workflow.update({
            where: { id },
            data: { activeVersionId: version.id, status: WorkflowStatus.PUBLISHED },
          });
          await tx.auditEvent.create({
            data: {
              actorId: user.id,
              entityType: 'WORKFLOW',
              entityId: id,
              action: 'WORKFLOW_PUBLISHED',
              metadata: json({
                versionId: version.id,
                versionNumber: version.versionNumber,
                revision: draft.revision,
              }),
            },
          });
          return version;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ApiException(
          'DRAFT_REVISION_CONFLICT',
          'A concurrent publish changed the workflow.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async versions(id: string, user: AuthUser) {
    await this.get(id, user);
    return this.prisma.workflowVersion.findMany({
      where: { workflowId: id },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        changeSummary: true,
        publishedAt: true,
        publishedBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async version(id: string, versionId: string, user: AuthUser) {
    await this.get(id, user);
    const version = await this.prisma.workflowVersion.findFirst({
      where: { id: versionId, workflowId: id },
    });
    if (!version)
      throw new ApiException(
        'WORKFLOW_NOT_FOUND',
        'Workflow version was not found.',
        HttpStatus.NOT_FOUND,
      );
    return version;
  }

  async diff(id: string, baseId: string, targetId: string, user: AuthUser) {
    const [base, target] = await Promise.all([
      this.version(id, baseId, user),
      this.version(id, targetId, user),
    ]);
    return {
      baseVersionId: base.id,
      targetVersionId: target.id,
      ...diffGraphs(graphFrom(base.graphSnapshot), graphFrom(target.graphSnapshot)),
    };
  }

  async duplicate(id: string, name: string | undefined, user: AuthUser) {
    const source = await this.owned(id, user);
    const draft = await this.prisma.workflowDraft.findUniqueOrThrow({ where: { workflowId: id } });
    return this.prisma.$transaction(async (tx) => {
      const copy = await tx.workflow.create({
        data: {
          name: name?.trim() || `${source.name} (Copy)`,
          description: source.description,
          ownerId: user.id,
          draft: {
            create: {
              revision: 1,
              graph: draft.graph as Prisma.InputJsonValue,
              viewport:
                draft.viewport === null
                  ? Prisma.JsonNull
                  : (draft.viewport as Prisma.InputJsonValue),
              updatedById: user.id,
            },
          },
        },
        include: { draft: true },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          entityType: 'WORKFLOW',
          entityId: copy.id,
          action: 'WORKFLOW_DUPLICATED',
          metadata: json({ sourceWorkflowId: id }),
        },
      });
      return copy;
    });
  }

  async archive(id: string, user: AuthUser) {
    await this.owned(id, user);
    return this.prisma.$transaction(async (tx) => {
      const workflow = await tx.workflow.update({
        where: { id },
        data: { status: WorkflowStatus.ARCHIVED, archivedAt: new Date(), activeVersionId: null },
      });
      await tx.auditEvent.create({
        data: {
          actorId: user.id,
          entityType: 'WORKFLOW',
          entityId: id,
          action: 'WORKFLOW_ARCHIVED',
          metadata: json({}),
        },
      });
      return workflow;
    });
  }
}
