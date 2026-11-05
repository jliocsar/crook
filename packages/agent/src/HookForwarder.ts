/* oxlint-disable effecttsgo/global-timers, promise/always-return */
const HOOK_SUBCOMMAND = 'hook'
const ARGUMENTS_BEFORE_SUBCOMMAND = 2
const HOOK_SOCKET_FILE = 'crook/hook.sock'
const EMPTY_VARIABLE = ''
const SLOWEST_MEASURED_DELIVERY_MILLIS = 15.139
const HOOK_DELIVERY_TIMEOUT_MILLIS = SLOWEST_MEASURED_DELIVERY_MILLIS * 10

export const isBareHookCall = (argv: readonly string[]): boolean =>
  argv.length === ARGUMENTS_BEFORE_SUBCOMMAND + 1 &&
  argv[ARGUMENTS_BEFORE_SUBCOMMAND] === HOOK_SUBCOMMAND

export const hookSocketPath = (
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined => {
  const explicit = environment.CROOK_HOOK_SOCKET_PATH
  const stateHome = environment.XDG_STATE_HOME
  const home = environment.HOME

  if (explicit !== undefined && explicit !== EMPTY_VARIABLE) {
    return explicit
  }

  if (stateHome?.startsWith('/') === true) {
    return `${stateHome}/${HOOK_SOCKET_FILE}`
  }

  return home === undefined || home === EMPTY_VARIABLE
    ? undefined
    : `${home}/.local/state/${HOOK_SOCKET_FILE}`
}

export const deliverPayload = (path: string, payload: Uint8Array, finished: () => void): void => {
  const timeout = setTimeout(finished, HOOK_DELIVERY_TIMEOUT_MILLIS)

  const finishedInTime = () => {
    clearTimeout(timeout)
    finished()
  }

  let unsent = payload

  const sendMore = (socket: Bun.Socket) => {
    unsent = unsent.subarray(socket.write(unsent))

    if (unsent.length === 0) {
      socket.end()
    }
  }

  void Bun.connect({
    unix: path,
    socket: {
      open: sendMore,
      drain: sendMore,
      data: () => undefined,
      close: finishedInTime,
      error: finishedInTime,
      connectError: finishedInTime,
    },
  }).catch(finishedInTime)
}

export const forwardStdin = (finished: () => void): void => {
  const path = hookSocketPath(Bun.env)

  void Bun.stdin
    .bytes()
    .then((payload) => {
      if (path === undefined) {
        finished()
      } else {
        deliverPayload(path, payload, finished)
      }
    })
    .catch(finished)
}
