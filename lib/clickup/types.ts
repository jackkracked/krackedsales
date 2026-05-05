export interface ClickUpTask {
  id: string;
  name: string;
  status: {
    status: string;
    color: string;
    type: string;
  };
  date_created: string; // Unix milliseconds as string
  date_updated: string;
  date_closed?: string | null;
  assignees: Array<{
    id: number;
    username: string;
    profilePicture?: string;
  }>;
  tags: Array<{ name: string; tag_fg: string; tag_bg: string }>;
  custom_fields?: Array<{ id: string; name: string; value?: unknown }>;
  parent: string | null; // null = parent task, string = subtask (value is parent task ID)
  time_spent?: number; // milliseconds
  url: string;
  list: { id: string; name: string };
  folder: { id: string; name: string };
  space: { id: string };
}

export interface ClickUpTasksResponse {
  tasks: ClickUpTask[];
}
