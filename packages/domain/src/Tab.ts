import * as Schema from 'effect/Schema'

import { TabId, WorkspaceId } from '@crook/domain/Ids'

export class Tab extends Schema.Class<Tab>('Tab')({
  id: TabId,
  workspace: WorkspaceId,
  label: Schema.String,
}) {}
