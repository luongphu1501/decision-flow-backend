CREATE TYPE "UserRole" AS ENUM ('DESIGNER', 'REVIEWER', 'REQUESTER');
CREATE TYPE "ReviewerRole" AS ENUM ('TEAM_LEAD', 'FINANCE');
CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "RequestStatus" AS ENUM ('IN_PROGRESS', 'WAITING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED');
CREATE TYPE "DecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');
CREATE TYPE "SimulationStatus" AS ENUM ('PAUSED', 'APPROVED', 'REJECTED', 'FAILED');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" "UserRole" NOT NULL,
  "reviewerRole" "ReviewerRole",
  "avatarUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Workflow" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "ownerId" UUID NOT NULL,
  "activeVersionId" UUID,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowDraft" (
  "workflowId" UUID NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "graph" JSONB NOT NULL,
  "viewport" JSONB,
  "updatedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkflowDraft_pkey" PRIMARY KEY ("workflowId")
);

CREATE TABLE "WorkflowVersion" (
  "id" UUID NOT NULL,
  "workflowId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "graphSnapshot" JSONB NOT NULL,
  "changeSummary" JSONB NOT NULL,
  "publishedById" UUID NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Request" (
  "id" UUID NOT NULL,
  "workflowVersionId" UUID NOT NULL,
  "requesterId" UUID NOT NULL,
  "formData" JSONB NOT NULL,
  "status" "RequestStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "currentNodeId" TEXT,
  "assignedReviewerRole" "ReviewerRole",
  "routeTrace" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Decision" (
  "id" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "reviewNodeId" TEXT NOT NULL,
  "reviewerId" UUID NOT NULL,
  "outcome" "DecisionOutcome" NOT NULL,
  "reason" TEXT,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Simulation" (
  "id" UUID NOT NULL,
  "workflowId" UUID NOT NULL,
  "draftRevision" INTEGER NOT NULL,
  "input" JSONB NOT NULL,
  "status" "SimulationStatus" NOT NULL,
  "trace" JSONB NOT NULL,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "actorId" UUID,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "responseBody" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Workflow_activeVersionId_key" ON "Workflow"("activeVersionId");
CREATE INDEX "Workflow_ownerId_status_idx" ON "Workflow"("ownerId", "status");
CREATE INDEX "WorkflowVersion_workflowId_publishedAt_idx" ON "WorkflowVersion"("workflowId", "publishedAt");
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_versionNumber_key" ON "WorkflowVersion"("workflowId", "versionNumber");
CREATE INDEX "Request_requesterId_status_idx" ON "Request"("requesterId", "status");
CREATE INDEX "Request_assignedReviewerRole_status_idx" ON "Request"("assignedReviewerRole", "status");
CREATE INDEX "Request_workflowVersionId_idx" ON "Request"("workflowVersionId");
CREATE INDEX "Decision_reviewerId_decidedAt_idx" ON "Decision"("reviewerId", "decidedAt");
CREATE UNIQUE INDEX "Decision_requestId_reviewNodeId_key" ON "Decision"("requestId", "reviewNodeId");
CREATE INDEX "Simulation_workflowId_createdAt_idx" ON "Simulation"("workflowId", "createdAt");
CREATE INDEX "AuditEvent_entityType_entityId_timestamp_idx" ON "AuditEvent"("entityType", "entityId", "timestamp");
CREATE INDEX "AuditEvent_actorId_timestamp_idx" ON "AuditEvent"("actorId", "timestamp");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");

ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkflowDraft" ADD CONSTRAINT "WorkflowDraft_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowDraft" ADD CONSTRAINT "WorkflowDraft_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Request" ADD CONSTRAINT "Request_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "WorkflowVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Request" ADD CONSTRAINT "Request_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
