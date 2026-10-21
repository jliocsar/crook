import * as React from 'react'

import { STARTING_VIEW } from '@crook/web/connection/ConnectionView'
import type { ConnectionView } from '@crook/web/connection/ConnectionView'

export const ConnectionContext = React.createContext<ConnectionView>(STARTING_VIEW)

export const useConnectionView = (): ConnectionView => React.useContext(ConnectionContext)
