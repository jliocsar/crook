import * as Schema from 'effect/Schema'

import { WorkspaceId } from '@crook/domain/Ids'

export class Workspace extends Schema.Class<Workspace>('Workspace')({
  id: WorkspaceId,
  label: Schema.String,
}) {}
