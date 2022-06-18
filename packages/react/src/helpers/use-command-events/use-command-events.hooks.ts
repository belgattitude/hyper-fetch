import { useRef } from "react";
import {
  ExtractError,
  isFailedRequest,
  ExtractResponse,
  CommandInstance,
  getErrorMessage,
  FetchProgressType,
  ClientResponseType,
  ExtractFetchReturn,
  CommandEventDetails,
  CommandResponseDetails,
  DispatcherLoadingEventType,
} from "@better-typed/hyper-fetch";
import { useDidUpdate, useIsMounted, useWillUnmount } from "@better-typed/react-lifecycle-hooks";

import {
  OnErrorCallbackType,
  OnStartCallbackType,
  OnSuccessCallbackType,
  OnProgressCallbackType,
  OnFinishedCallbackType,
  UseCommandEventsDataMap,
  UseCommandEventsReturnType,
  UseCommandEventsOptionsType,
  UseCommandEventsLifecycleMap,
} from "helpers";

/**
 * This is helper hook that handles main Hyper-Fetch event/data flow
 * @internal
 * @param options
 * @returns
 */
export const useCommandEvents = <T extends CommandInstance>({
  command,
  dispatcher,
  logger,
  state,
  actions,
  setCacheData,
  initializeCallbacks = false,
}: UseCommandEventsOptionsType<T>): UseCommandEventsReturnType<T> => {
  const { cache, appManager, commandManager } = command.builder;
  const commandDump = command.dump();

  const isMounted = useIsMounted();

  // ******************
  // Callbacks
  // ******************

  const onSuccessCallback = useRef<null | OnSuccessCallbackType<ExtractResponse<T>>>(null);
  const onErrorCallback = useRef<null | OnErrorCallbackType<ExtractError<T>>>(null);
  const onAbortCallback = useRef<null | OnErrorCallbackType<ExtractError<T>>>(null);
  const onOfflineErrorCallback = useRef<null | OnErrorCallbackType<ExtractError<T>>>(null);
  const onFinishedCallback = useRef<null | OnFinishedCallbackType<ExtractFetchReturn<T>>>(null);
  const onRequestStartCallback = useRef<null | OnStartCallbackType<T>>(null);
  const onResponseStartCallback = useRef<null | OnStartCallbackType<T>>(null);
  const onDownloadProgressCallback = useRef<null | OnProgressCallbackType>(null);
  const onUploadProgressCallback = useRef<null | OnProgressCallbackType>(null);

  // ******************
  // Listeners unmounting
  // ******************

  const lifecycleEvents = useRef<UseCommandEventsLifecycleMap>(new Map());
  const dataEvents = useRef<UseCommandEventsDataMap | null>(null);

  // ******************
  // Response handlers
  // ******************

  const handleResponseCallbacks = (
    data: ClientResponseType<ExtractResponse<T>, ExtractError<T>>,
    details: CommandResponseDetails,
  ) => {
    if (!isMounted) return logger.debug("Callback cancelled, component is unmounted");

    const { isOffline, isFailed, isCanceled } = details;

    if (command.offline && isOffline && isFailed) {
      logger.debug("Performing offline error callback", { data, details });
      onOfflineErrorCallback.current?.(data[1] as ExtractError<T>, details);
    } else if (isCanceled) {
      logger.debug("Performing abort callback", { data, details });
      onAbortCallback.current?.(data[1] as ExtractError<T>, details);
    } else if (!isFailed) {
      logger.debug("Performing success callback", { data, details });
      onSuccessCallback.current?.(data[0] as ExtractResponse<T>, details);
    } else {
      logger.debug("Performing error callback", { data, details });
      onErrorCallback.current?.(data[1] as ExtractError<T>, details);
    }
    onFinishedCallback.current?.(data, details);
  };

  const handleInitialCallbacks = () => {
    const hasData = state.data && state.error && state.timestamp;
    if (hasData && initializeCallbacks) {
      const details = {
        retries: state.retries,
        timestamp: new Date(state.timestamp as Date),
        isFailed: isFailedRequest([state.data, state.error, state.status]),
        isCanceled: false,
        isOffline: !appManager.isOnline,
      };

      handleResponseCallbacks([state.data, state.error, state.status], details);
    }
  };

  // ******************
  // Lifecycle
  // ******************

  const handleGetLoadingEvent = ({ isLoading }: DispatcherLoadingEventType) => {
    actions.setLoading(isLoading, false);
  };

  const handleDownloadProgress = (progress: FetchProgressType) => {
    onDownloadProgressCallback?.current?.(progress);
  };

  const handleUploadProgress = (progress: FetchProgressType) => {
    onUploadProgressCallback?.current?.(progress);
  };

  const handleRequestStart = (details: CommandEventDetails<T>) => {
    onRequestStartCallback?.current?.(details);
  };

  const handleResponseStart = (details: CommandEventDetails<T>) => {
    onResponseStartCallback?.current?.(details);
  };

  const handleResponse = (requestId: string) => {
    return (data: ClientResponseType<ExtractResponse<T>, ExtractError<T>>, details: CommandResponseDetails) => {
      const event = lifecycleEvents.current.get(requestId);
      event?.unmount();
      lifecycleEvents.current.delete(requestId);

      handleResponseCallbacks(data, details);
    };
  };

  const handleAbort = () => {
    const data: ClientResponseType<ExtractResponse<T>, ExtractError<T>> = [
      null,
      // @ts-ignore
      getErrorMessage("abort") as ExtractResponse<T>,
      0,
    ];
    const details: CommandResponseDetails = {
      retries: 0,
      timestamp: new Date(),
      isFailed: false,
      isCanceled: true,
      isOffline: false,
    };
    handleResponseCallbacks(data, details);
  };

  // ******************
  // Data Listeners
  // ******************

  const clearDataListener = () => {
    dataEvents.current?.unmount();
  };

  const addDataListener = (cmd: CommandInstance, clear = true) => {
    // Data handlers
    const loadingUnmount = dispatcher.events.onLoading(cmd.queueKey, handleGetLoadingEvent);
    const getResponseUnmount = cache.events.get<ExtractResponse<T>, ExtractError<T>>(cmd.cacheKey, (data) =>
      setCacheData(data),
    );
    const abortUnmount = commandManager.events.onAbort(cmd.abortKey, handleAbort);

    const unmount = () => {
      loadingUnmount();
      getResponseUnmount();
      abortUnmount();
    };

    if (clear) clearDataListener();
    dataEvents.current = { unmount };

    return unmount;
  };

  // ******************
  // Lifecycle Listeners
  // ******************

  const addLifecycleListeners = (requestId: string) => {
    const downloadUnmount = commandManager.events.onDownloadProgressById(requestId, handleDownloadProgress);
    const uploadUnmount = commandManager.events.onUploadProgressById(requestId, handleUploadProgress);
    const requestStartUnmount = commandManager.events.onRequestStartById(requestId, handleRequestStart);
    const responseStartUnmount = commandManager.events.onResponseStartById(requestId, handleResponseStart);
    const responseUnmount = commandManager.events.onResponseById(requestId, handleResponse(requestId));

    const unmount = () => {
      downloadUnmount();
      uploadUnmount();
      requestStartUnmount();
      responseStartUnmount();
      responseUnmount();
    };

    lifecycleEvents.current.set(requestId, { unmount });

    return unmount;
  };

  const removeLifecycleListener = (requestId: string) => {
    const event = lifecycleEvents.current.get(requestId);
    event?.unmount();
    lifecycleEvents.current.delete(requestId);
  };

  const clearLifecycleListeners = () => {
    const events = lifecycleEvents.current;
    const listeners = Array.from(events.values());
    listeners.forEach((value) => {
      value.unmount();
    });
    events.clear();
  };

  /**
   * Initialization of the events related to data exchange with cache and queue
   * This allow to share the state with other hooks and keep it related
   */

  /**
   * On the init if we have data we should call the callback functions
   */
  useDidUpdate(handleInitialCallbacks, [commandDump.cacheKey, commandDump.queueKey], true);

  /**
   * On unmount we want to clear all the listeners to prevent memory leaks
   */
  useWillUnmount(() => {
    // Unmount listeners
    clearLifecycleListeners();
    clearDataListener();
  });

  return [
    {
      onSuccess: (callback: OnSuccessCallbackType<ExtractResponse<T>>) => {
        onSuccessCallback.current = callback;
      },
      onError: (callback: OnErrorCallbackType<ExtractError<T>>) => {
        onErrorCallback.current = callback;
      },
      onAbort: (callback: OnErrorCallbackType<ExtractError<T>>) => {
        onAbortCallback.current = callback;
      },
      onOfflineError: (callback: OnErrorCallbackType<ExtractError<T>>) => {
        onOfflineErrorCallback.current = callback;
      },
      onFinished: (callback: OnFinishedCallbackType<ExtractFetchReturn<T>>) => {
        onFinishedCallback.current = callback;
      },
      onRequestStart: (callback: OnStartCallbackType<T>) => {
        onRequestStartCallback.current = callback;
      },
      onResponseStart: (callback: OnStartCallbackType<T>) => {
        onResponseStartCallback.current = callback;
      },
      onDownloadProgress: (callback: OnProgressCallbackType) => {
        onDownloadProgressCallback.current = callback;
      },
      onUploadProgress: (callback: OnProgressCallbackType) => {
        onUploadProgressCallback.current = callback;
      },
    },
    {
      addDataListener,
      clearDataListener,
      addLifecycleListeners,
      removeLifecycleListener,
      clearLifecycleListeners,
    },
  ];
};
