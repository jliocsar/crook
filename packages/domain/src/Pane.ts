import * as Schema from 'effect/Schema'

import { PaneId, TabId, WorkspaceId } from '@crook/domain/Ids'

export class Pane extends Schema.Class<Pane>('Pane')({
  id: PaneId,
  workspace: WorkspaceId,
  tab: TabId,
}) {}
