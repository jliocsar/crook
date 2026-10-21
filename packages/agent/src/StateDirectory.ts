import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as FileSystem from 'effect/FileSystem'
import * as Path from 'effect/Path'

import { AbsolutePath } from '@crook/domain/AbsolutePath'

const TEMPORARY_SUFFIX = '.tmp'

export const OWNER_ONLY_FILE_MODE = 0o600
export const OWNER_ONLY_DIRECTORY_MODE = 0o700

export const CrookStateDirectory = Config.schema(AbsolutePath, 'XDG_STATE_HOME').pipe(
  Config.orElse(() => Config.String('HOME').pipe(Config.map((home) => `${home}/.local/state`))),
  Config.map((stateHome) => `${stateHome}/crook`),
)

export const stateFile = (variable: string, fileName: string) =>
  Config.String(variable).pipe(
    Config.orElse(() => Config.map(CrookStateDirectory, (directory) => `${directory}/${fileName}`)),
  )

export const makeEnsureParentDirectory = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  return (file: string) =>
    fileSystem.makeDirectory(path.dirname(file), {
      recursive: true,
      mode: OWNER_ONLY_DIRECTORY_MODE,
    })
})

export const makeWriteAtomically = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const ensureParentDirectory = yield* makeEnsureParentDirectory

  return (file: string, content: string) => {
    const temporary = `${file}${TEMPORARY_SUFFIX}`

    return ensureParentDirectory(file).pipe(
      Effect.andThen(fileSystem.writeFileString(temporary, content)),
      Effect.andThen(fileSystem.rename(temporary, file)),
    )
  }
})
