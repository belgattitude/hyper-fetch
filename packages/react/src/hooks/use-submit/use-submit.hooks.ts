import { useMemo, useRef } from "react";
import {
  Request,
  getRequestKey,
  ExtractAdapterReturnType,
  requestSendRequest,
  RequestInstance,
  ResponseType,
  ExtractResponseType,
  ExtractErrorType,
  RequestSendOptionsType,
  RequestSendType,
} from "@hyper-fetch/core";
import { useDidMount } from "@better-hooks/lifecycle";
import { useDebounce, useThrottle } from "@better-hooks/performance";

import { UseSubmitOptionsType, useSubmitDefaultOptions, UseSubmitReturnType } from "hooks/use-submit";
import { useTrackedState, useRequestEvents } from "helpers";
import { useConfigProvider } from "config-provider";
import { getBounceData } from "utils";
import { InvalidationKeyType } from "types";

/**
 * This hooks aims to mutate data on the server.
 * @param request
 * @param options
 * @returns
 */
export const useSubmit = <RequestType extends RequestInstance>(
  request: RequestType,
  options: UseSubmitOptionsType<RequestType> = useSubmitDefaultOptions,
): UseSubmitReturnType<RequestType> => {
  // Build the configuration options
  const [globalConfig] = useConfigProvider();
  const mergedOptions = useMemo(
    () => ({
      ...useSubmitDefaultOptions,
      ...globalConfig.useSubmitConfig,
      ...options,
    }),
    [JSON.stringify(globalConfig.useSubmitConfig), JSON.stringify(options)],
  );
  const { disabled, dependencyTracking, initialData, bounce, bounceType, bounceTime, bounceTimeout, deepCompare } =
    mergedOptions;

  /**
   * Because of the dynamic cacheKey / queueKey signing within the request we need to store it's latest instance
   * so the events got triggered properly and show the latest result without mixing it up
   */
  const { client } = request;
  const { cache, submitDispatcher: dispatcher, loggerManager } = client;

  const logger = useRef(loggerManager.init("useSubmit")).current;
  const requestDebounce = useDebounce({ delay: bounceTime });
  const requestThrottle = useThrottle({ interval: bounceTime, timeout: bounceTimeout });
  const bounceResolver = useRef<
    (value: ResponseType<ExtractResponseType<RequestType>, ExtractErrorType<RequestType>>) => void
  >(() => null);

  const bounceData = bounceType === "throttle" ? requestThrottle : requestDebounce;
  const bounceFunction = bounceType === "throttle" ? requestThrottle.throttle : requestDebounce.debounce;

  /**
   * State handler with optimization for rerendering, that hooks into the cache state and dispatchers queues
   */
  const [state, actions, { setRenderKey, setCacheData }] = useTrackedState<RequestType>({
    logger,
    request,
    dispatcher,
    initialData,
    deepCompare,
    dependencyTracking,
  });

  /**
   * Handles the data exchange with the core logic - responses, loading, downloading etc
   */
  const [callbacks, listeners] = useRequestEvents({
    logger,
    actions,
    request,
    dispatcher,
    setCacheData,
  });

  const { addDataListener, addLifecycleListeners } = listeners;

  // ******************
  // Submitting
  // ******************

  const handleSubmit: RequestSendType<RequestType> = (submitOptions?: RequestSendOptionsType<RequestType>) => {
    const requestClone = request.clone(submitOptions as any) as RequestType;

    if (disabled) {
      logger.warning(`Cannot submit request`, { disabled, submitOptions });
      return Promise.resolve([null, new Error("Cannot submit request. Option 'disabled' is enabled"), 0]) as Promise<
        ResponseType<ExtractResponseType<RequestType>, ExtractErrorType<RequestType>>
      >;
    }

    const triggerRequest = () => {
      addDataListener(requestClone);
      return requestSendRequest(requestClone, {
        dispatcherType: "submit",
        ...submitOptions,
        onSettle: (requestId, cmd) => {
          addLifecycleListeners(requestClone, requestId);
          submitOptions?.onSettle?.(requestId, cmd);
        },
      });
    };

    return new Promise<ExtractAdapterReturnType<RequestType>>((resolve) => {
      const performSubmit = async () => {
        logger.debug(`Submitting request`, { disabled, submitOptions });
        if (bounce) {
          const bouncedResolve = bounceResolver.current;
          // We need to keep the resolve of debounced requests to prevent memory leaks - we need to always resolve promise.
          // By default bounce method will prevent function to be triggered, but returned promise will still await to be resolved.
          // This way we can close previous promise, making sure our logic will not stuck in memory.
          bounceResolver.current = (
            value: ResponseType<ExtractResponseType<RequestType>, ExtractErrorType<RequestType>>,
          ) => {
            // Trigger previous awaiting calls to resolve together in bounced batches
            bouncedResolve(value);
            resolve(value);
          };

          // Start bounce
          bounceFunction(async () => {
            // We will always resolve previous calls as we stack the callbacks together until bounce function trigger
            const callback = bounceResolver.current;
            // Clean bounce resolvers to start the new stack
            bounceResolver.current = () => null;

            const value = await triggerRequest();
            callback(value);
          });
        } else {
          const value = await triggerRequest();
          resolve(value);
        }
      };

      performSubmit();
    });
  };

  // ******************
  // Revalidation
  // ******************

  const handleRevalidation = (invalidateKey: InvalidationKeyType) => {
    if (invalidateKey && invalidateKey instanceof Request) {
      cache.revalidate(getRequestKey(invalidateKey));
    } else if (invalidateKey && !(invalidateKey instanceof Request)) {
      cache.revalidate(invalidateKey);
    }
  };

  const revalidate = (invalidateKey: InvalidationKeyType | InvalidationKeyType[]) => {
    if (!invalidateKey) return;

    if (invalidateKey && Array.isArray(invalidateKey)) {
      invalidateKey.forEach(handleRevalidation);
    } else if (invalidateKey && !Array.isArray(invalidateKey)) {
      handleRevalidation(invalidateKey);
    }
  };

  // ******************
  // Misc
  // ******************

  const handlers = {
    onSubmitSuccess: callbacks.onSuccess,
    onSubmitError: callbacks.onError,
    onSubmitFinished: callbacks.onFinished,
    onSubmitRequestStart: callbacks.onRequestStart,
    onSubmitResponseStart: callbacks.onResponseStart,
    onSubmitDownloadProgress: callbacks.onDownloadProgress,
    onSubmitUploadProgress: callbacks.onUploadProgress,
    onSubmitOfflineError: callbacks.onOfflineError,
    onSubmitAbort: callbacks.onAbort,
  };

  // ******************
  // Lifecycle
  // ******************

  useDidMount(() => {
    addDataListener(request);
  });

  return {
    submit: handleSubmit,
    get data() {
      setRenderKey("data");
      return state.data;
    },
    get error() {
      setRenderKey("error");
      return state.error;
    },
    get submitting() {
      setRenderKey("loading");
      return state.loading;
    },
    get status() {
      setRenderKey("status");
      return state.status;
    },
    get retries() {
      setRenderKey("retries");
      return state.retries;
    },
    get timestamp() {
      setRenderKey("timestamp");
      return state.timestamp;
    },
    abort: callbacks.abort,
    ...actions,
    ...handlers,
    bounce: getBounceData(bounceData),
    revalidate,
  };
};
