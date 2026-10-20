import * as Config from 'effect/Config'

export const OWNER_ONLY_FILE_MODE = 0o600
export const OWNER_ONLY_DIRECTORY_MODE = 0o700

export const CrookStateDirectory = Config.String('XDG_STATE_HOME').pipe(
  Config.orElse(() => Config.String('HOME').pipe(Config.map((home) => `${home}/.local/state`))),
  Config.map((stateHome) => `${stateHome}/crook`),
)

export const stateFile = (variable: string, fileName: string) =>
  Config.String(variable).pipe(
    Config.orElse(() => Config.map(CrookStateDirectory, (directory) => `${directory}/${fileName}`)),
  )
