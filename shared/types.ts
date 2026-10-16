export type Role = 'admin' | 'member';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskScope = 'assigned' | 'created' | 'all';
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办', in_progress: '进行中', done: '已完成',
};

export interface Member {
  id: string;
  username: string;
  displayName: string;
}
export interface User extends Member {
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  createdAt: string;
}
export interface AdminUser extends User { openTaskCount: number }
export interface Task {
  id: string;
  title: string;
  description: string;
  creatorId: string;
  assigneeIds: string[];
  creator: Member;
  assignees: Member[];
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  overdue: boolean;
}
export interface TaskInput {
  title: string;
  description?: string;
  assigneeIds: string[];
  dueDate?: string | null;
}
export type TaskPatch = Partial<TaskInput> & { version: number; status?: TaskStatus };
export function canEditTask(user: Pick<User, 'id' | 'role'>, task: Pick<Task, 'creatorId'>): boolean {
  return user.role === 'admin' || task.creatorId === user.id;
}
export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }
export interface TaskSummary {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
  overdue: number;
  dueToday: number;
}
export type TaskNotificationKind = 'assigned' | 'due_soon' | 'overdue';
interface NotificationBase {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}
export type Notification = NotificationBase & (
  { kind: TaskNotificationKind; taskId: string; sharedInfoId: null } |
  { kind: 'shared_published'; taskId: null; sharedInfoId: string }
);
export interface Category { id: string; name: string; count: number }
export interface SharedInfo {
  id: string;
  title: string;
  content: string;
  categoryId: string | null;
  categoryName: string | null;
  authorId: string;
  author: Member;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface SharedInput { title: string; content: string; categoryId: string | null }
export interface ReportGroup {
  member: Member;
  completed: Task[];
  open: Task[];
  overdue: number;
}
export interface MonthlyReport {
  month: string;
  scope: 'personal' | 'team';
  asOf: string;
  current: boolean;
  member: Member | null;
  groups: ReportGroup[];
  totals: { completed: number; open: number; overdue: number };
}
