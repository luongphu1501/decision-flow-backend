import { ReviewerRole, UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  reviewerRole: ReviewerRole | null;
}
