export type NodeType = 'start' | 'condition' | 'review' | 'approve' | 'reject';
export type Branch = 'true' | 'false' | 'approved' | 'rejected' | 'default';
export type ConditionField = 'amount' | 'department' | 'category' | 'requesterId';
export type ReviewerRoleValue = 'team_lead' | 'finance';
export const ALLOWED_DEPARTMENTS = ['Engineering', 'Finance', 'Operations', 'Sales', 'HR'] as const;
export const ALLOWED_CATEGORIES = ['Equipment', 'Travel', 'Software', 'Other'] as const;

export interface Position {
  x: number;
  y: number;
}

export interface StartConfig {
  displayName?: string;
}

export interface ConditionConfig {
  field: ConditionField;
  operator: '>' | '>=' | '<' | '<=' | '=' | '!=' | 'in' | 'not in';
  value: unknown;
}

export interface ReviewConfig {
  reviewerRole: ReviewerRoleValue;
  instruction?: string;
  requireApprovalReason?: boolean;
}

export interface TerminalConfig {
  finalMessage?: string;
}

export type NodeConfig = StartConfig | ConditionConfig | ReviewConfig | TerminalConfig;

export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  position: Position;
  config: NodeConfig;
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  sourceHandle?: string;
  targetNodeId: string;
  label?: string;
  branch?: Branch;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ValidationIssue {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
  path?: string;
}

export interface GraphValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  errors: number;
  warnings: number;
}

export interface SimulationInput {
  amount: number;
  department: string;
  category: string;
  requesterId: string;
  description?: string;
}

export type FixtureDecision = 'approved' | 'rejected';

export interface TraceStep {
  index: number;
  nodeId: string;
  nodeType: NodeType;
  nodeName: string;
  enteredAt: string;
  status: 'completed' | 'paused';
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  selectedEdgeId?: string;
  explanation: string;
}

export interface SimulationResult {
  status: 'PAUSED' | 'APPROVED' | 'REJECTED';
  currentNodeId: string | null;
  assignedReviewerRole: ReviewerRoleValue | null;
  trace: TraceStep[];
}
