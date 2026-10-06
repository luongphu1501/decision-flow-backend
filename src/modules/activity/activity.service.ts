import { Injectable } from '@nestjs/common';
import { Prisma, RequestStatus, UserRole } from '@prisma/client';
import { AuthUser } from '../../common/auth/auth-user';
import { PrismaService } from '../../prisma/prisma.service';
import { ActivityQueryDto } from './activity.dto';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ActivityQueryDto, user: AuthUser) {
    let access: Prisma.AuditEventWhereInput;
    if (user.role === UserRole.DESIGNER) {
      const workflows = await this.prisma.workflow.findMany({
        where: { ownerId: user.id },
        select: { id: true },
      });
      const workflowIds = workflows.map((workflow) => workflow.id);
      const requests = await this.prisma.request.findMany({
        where: { workflowVersion: { workflowId: { in: workflowIds } } },
        select: { id: true },
      });
      access = {
        OR: [
          { entityType: 'WORKFLOW', entityId: { in: workflowIds } },
          { entityType: 'REQUEST', entityId: { in: requests.map((request) => request.id) } },
        ],
      };
    } else if (user.role === UserRole.REQUESTER) {
      const requests = await this.prisma.request.findMany({
        where: { requesterId: user.id },
        select: { id: true },
      });
      access = { entityType: 'REQUEST', entityId: { in: requests.map((request) => request.id) } };
    } else {
      const requests = await this.prisma.request.findMany({
        where: {
          OR: [
            { decisions: { some: { reviewerId: user.id } } },
            {
              status: RequestStatus.WAITING_REVIEW,
              assignedReviewerRole: user.reviewerRole ?? undefined,
            },
          ],
        },
        select: { id: true },
      });
      access = { entityType: 'REQUEST', entityId: { in: requests.map((request) => request.id) } };
    }
    const where: Prisma.AuditEventWhereInput = {
      AND: [
        access,
        ...(query.entityType ? [{ entityType: query.entityType }] : []),
        ...(query.action ? [{ action: query.action }] : []),
      ],
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { timestamp: 'desc' },
        include: { actor: { select: { id: true, name: true, email: true, role: true } } },
      }),
      this.prisma.auditEvent.count({ where }),
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
}
