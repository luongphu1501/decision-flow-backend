import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DecisionOutcome,
  Prisma,
  RequestStatus,
  ReviewerRole,
  UserRole,
  WorkflowStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import { isUUID } from 'class-validator';
import { AuthUser } from '../../common/auth/auth-user';
import { ApiException } from '../../common/errors/api.exception';
import { FixtureDecision, ReviewConfig, simulateGraph, WorkflowGraph } from '../../domain/graph';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRequestDto, DecisionDto, InboxQueryDto, ListRequestsQueryDto } from './requests.dto';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const graphFrom = (value: Prisma.JsonValue): WorkflowGraph => value as unknown as WorkflowGraph;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashRequest(dto: CreateRequestDto): string {
  return createHash('sha256').update(canonical(dto)).digest('hex');
}

function reviewerRole(value: 'team_lead' | 'finance' | null): ReviewerRole | null {
  if (value === 'team_lead') return ReviewerRole.TEAM_LEAD;
  if (value === 'finance') return ReviewerRole.FINANCE;
  return null;
}

function routeState(status: 'PAUSED' | 'APPROVED' | 'REJECTED'): RequestStatus {
  if (status === 'PAUSED') return RequestStatus.WAITING_REVIEW;
  return status === 'APPROVED' ? RequestStatus.APPROVED : RequestStatus.REJECTED;
}

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateRequestDto, idempotencyKey: string, user: AuthUser) {
    if (!idempotencyKey || !isUUID(idempotencyKey)) {
      throw new ApiException(
        'VALIDATION_ERROR',
        'Idempotency-Key must be a UUID.',
        HttpStatus.BAD_REQUEST,
        { field: 'Idempotency-Key' },
      );
    }
    const operation = 'CREATE_REQUEST';
    const requestHash = hashRequest(dto);
    const previous = await this.prisma.idempotencyRecord.findUnique({
      where: { userId_operation_key: { userId: user.id, operation, key: idempotencyKey } },
    });
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new ApiException(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used with another payload.',
          HttpStatus.CONFLICT,
        );
      }
      return previous.responseBody;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const workflow = await tx.workflow.findFirst({
          where: { id: dto.workflowId, status: WorkflowStatus.PUBLISHED, archivedAt: null },
          include: { activeVersion: true },
        });
        if (!workflow?.activeVersion) {
          throw new ApiException(
            'NO_ACTIVE_WORKFLOW_VERSION',
            'Workflow has no active published version.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const input = {
          amount: dto.amount,
          department: dto.department,
          category: dto.category,
          requesterId: user.id,
          description: dto.description,
        };
        const route = simulateGraph(graphFrom(workflow.activeVersion.graphSnapshot), input);
        const state = routeState(route.status);
        const request = await tx.request.create({
          data: {
            workflowVersionId: workflow.activeVersion.id,
            requesterId: user.id,
            formData: json(input),
            status: state,
            currentNodeId: route.currentNodeId,
            assignedReviewerRole: reviewerRole(route.assignedReviewerRole),
            routeTrace: json(route.trace),
            completedAt: state === RequestStatus.WAITING_REVIEW ? null : new Date(),
          },
        });
        await tx.auditEvent.createMany({
          data: [
            {
              actorId: user.id,
              entityType: 'REQUEST',
              entityId: request.id,
              action: 'REQUEST_SUBMITTED',
              metadata: json({
                workflowId: workflow.id,
                workflowVersionId: workflow.activeVersion.id,
              }),
            },
            {
              actorId: user.id,
              entityType: 'REQUEST',
              entityId: request.id,
              action: 'REQUEST_ROUTED',
              metadata: json({
                status: state,
                currentNodeId: route.currentNodeId,
                assignedReviewerRole: route.assignedReviewerRole,
              }),
            },
            ...(state !== RequestStatus.WAITING_REVIEW
              ? [
                  {
                    actorId: user.id,
                    entityType: 'REQUEST',
                    entityId: request.id,
                    action: 'REQUEST_COMPLETED',
                    metadata: json({ status: state }),
                  },
                ]
              : []),
          ],
        });
        const response = {
          id: request.id,
          workflowId: workflow.id,
          workflowVersionId: request.workflowVersionId,
          workflowVersionNumber: workflow.activeVersion.versionNumber,
          status: request.status,
          currentNodeId: request.currentNodeId,
          assignedReviewerRole: request.assignedReviewerRole,
          formData: input,
          routeTrace: route.trace,
          createdAt: request.createdAt.toISOString(),
          updatedAt: request.updatedAt.toISOString(),
        };
        await tx.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            userId: user.id,
            operation,
            requestHash,
            responseStatus: HttpStatus.CREATED,
            responseBody: json(response),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        return response;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const record = await this.prisma.idempotencyRecord.findUnique({
          where: { userId_operation_key: { userId: user.id, operation, key: idempotencyKey } },
        });
        if (record?.requestHash === requestHash) return record.responseBody;
        throw new ApiException(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key was already used with another payload.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async list(query: ListRequestsQueryDto, user: AuthUser) {
    const where: Prisma.RequestWhereInput = {
      requesterId: user.id,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.request.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          workflowVersion: {
            select: {
              id: true,
              versionNumber: true,
              workflow: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.request.count({ where }),
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

  async inbox(query: InboxQueryDto, user: AuthUser) {
    if (!user.reviewerRole) {
      throw new ApiException(
        'REVIEW_ASSIGNMENT_MISMATCH',
        'Reviewer does not have an assignment role.',
        HttpStatus.FORBIDDEN,
      );
    }
    const where: Prisma.RequestWhereInput =
      query.tab === 'pending'
        ? { status: RequestStatus.WAITING_REVIEW, assignedReviewerRole: user.reviewerRole }
        : {
            decisions: { some: { reviewerId: user.id } },
            status: {
              in: [RequestStatus.APPROVED, RequestStatus.REJECTED, RequestStatus.WAITING_REVIEW],
            },
          };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.request.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          workflowVersion: {
            select: { versionNumber: true, workflow: { select: { id: true, name: true } } },
          },
          decisions: { orderBy: { decidedAt: 'asc' } },
        },
      }),
      this.prisma.request.count({ where }),
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
    const request = await this.prisma.request.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        workflowVersion: {
          include: { workflow: { select: { id: true, name: true, ownerId: true } } },
        },
        decisions: {
          include: { reviewer: { select: { id: true, name: true, email: true } } },
          orderBy: { decidedAt: 'asc' },
        },
      },
    });
    if (!request)
      throw new ApiException('REQUEST_NOT_FOUND', 'Request was not found.', HttpStatus.NOT_FOUND);
    const allowed =
      request.requesterId === user.id ||
      (user.role === UserRole.DESIGNER && request.workflowVersion.workflow.ownerId === user.id) ||
      (user.role === UserRole.REVIEWER &&
        (request.assignedReviewerRole === user.reviewerRole ||
          request.decisions.some((decision) => decision.reviewerId === user.id)));
    if (!allowed)
      throw new ApiException(
        'PERMISSION_DENIED',
        'You cannot access this request.',
        HttpStatus.FORBIDDEN,
      );
    const timeline = await this.prisma.auditEvent.findMany({
      where: { entityType: 'REQUEST', entityId: id },
      orderBy: { timestamp: 'asc' },
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
    return { ...request, timeline };
  }

  async decide(id: string, dto: DecisionDto, user: AuthUser) {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const request = await tx.request.findUnique({
            where: { id },
            include: { workflowVersion: true, decisions: true },
          });
          if (!request)
            throw new ApiException(
              'REQUEST_NOT_FOUND',
              'Request was not found.',
              HttpStatus.NOT_FOUND,
            );
          if (request.status !== RequestStatus.WAITING_REVIEW || !request.currentNodeId) {
            throw new ApiException(
              'REQUEST_ALREADY_DECIDED',
              'This request is not waiting for a decision.',
              HttpStatus.CONFLICT,
            );
          }
          if (!user.reviewerRole || request.assignedReviewerRole !== user.reviewerRole) {
            throw new ApiException(
              'REVIEW_ASSIGNMENT_MISMATCH',
              'Request is assigned to another reviewer role.',
              HttpStatus.FORBIDDEN,
            );
          }
          const graph = graphFrom(request.workflowVersion.graphSnapshot);
          const node = graph.nodes.find((item) => item.id === request.currentNodeId);
          if (!node || node.type !== 'review') {
            throw new ApiException(
              'SIMULATION_FAILED',
              'Current review node is missing from the published version.',
              HttpStatus.UNPROCESSABLE_ENTITY,
            );
          }
          const config = node.config as ReviewConfig;
          const reason = dto.reason?.trim();
          if (dto.outcome === 'REJECTED' && !reason) {
            throw new ApiException(
              'VALIDATION_ERROR',
              'A rejection reason is required.',
              HttpStatus.BAD_REQUEST,
              { field: 'reason' },
            );
          }
          if (dto.outcome === 'APPROVED' && config.requireApprovalReason && !reason) {
            throw new ApiException(
              'VALIDATION_ERROR',
              'An approval reason is required for this review step.',
              HttpStatus.BAD_REQUEST,
              { field: 'reason' },
            );
          }
          await tx.decision.create({
            data: {
              requestId: id,
              reviewNodeId: node.id,
              reviewerId: user.id,
              outcome: dto.outcome,
              reason,
            },
          });
          const decisions: Record<string, FixtureDecision> = Object.fromEntries(
            request.decisions.map((decision) => [
              decision.reviewNodeId,
              decision.outcome === DecisionOutcome.APPROVED ? 'approved' : 'rejected',
            ]),
          );
          decisions[node.id] = dto.outcome === 'APPROVED' ? 'approved' : 'rejected';
          const input = request.formData as unknown as {
            amount: number;
            department: string;
            category: string;
            requesterId: string;
            description?: string;
          };
          const route = simulateGraph(graph, input, decisions);
          const state = routeState(route.status);
          const updated = await tx.request.updateMany({
            where: { id, status: RequestStatus.WAITING_REVIEW, currentNodeId: node.id },
            data: {
              status: state,
              currentNodeId: route.currentNodeId,
              assignedReviewerRole: reviewerRole(route.assignedReviewerRole),
              routeTrace: json(route.trace),
              completedAt: state === RequestStatus.WAITING_REVIEW ? null : new Date(),
            },
          });
          if (updated.count !== 1) {
            throw new ApiException(
              'REQUEST_ALREADY_DECIDED',
              'This review step was already decided.',
              HttpStatus.CONFLICT,
            );
          }
          await tx.auditEvent.createMany({
            data: [
              {
                actorId: user.id,
                entityType: 'REQUEST',
                entityId: id,
                action: 'REVIEW_DECIDED',
                metadata: json({
                  reviewNodeId: node.id,
                  outcome: dto.outcome,
                  reason: reason ?? null,
                }),
              },
              {
                actorId: user.id,
                entityType: 'REQUEST',
                entityId: id,
                action: 'REQUEST_ROUTED',
                metadata: json({
                  status: state,
                  currentNodeId: route.currentNodeId,
                  assignedReviewerRole: route.assignedReviewerRole,
                }),
              },
              ...(state !== RequestStatus.WAITING_REVIEW
                ? [
                    {
                      actorId: user.id,
                      entityType: 'REQUEST',
                      entityId: id,
                      action: 'REQUEST_COMPLETED',
                      metadata: json({ status: state }),
                    },
                  ]
                : []),
            ],
          });
          return {
            id,
            status: state,
            currentNodeId: route.currentNodeId,
            assignedReviewerRole: reviewerRole(route.assignedReviewerRole),
            routeTrace: route.trace,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ['P2002', 'P2034'].includes(error.code)
      ) {
        throw new ApiException(
          'REQUEST_ALREADY_DECIDED',
          'This review step was already decided.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }
}
