import { startServer, resetInterceptors, stopServer, createRequestInterceptor } from "../../server";
import { testErrorState, testSuccessState } from "../../shared";
import { client, createRequest, renderUseFetch, waitForRender } from "../../utils";

describe("useFetch [ Deduplication ]", () => {
  let dedupeRequest = createRequest({ deduplicate: true, deduplicateTime: 100, retry: 5, retryTime: 200 });

  beforeAll(() => {
    startServer();
  });

  afterEach(() => {
    resetInterceptors();
  });

  afterAll(() => {
    stopServer();
  });

  beforeEach(() => {
    dedupeRequest = createRequest({ deduplicate: true, deduplicateTime: 100, retry: 5, retryTime: 200 });
    jest.resetModules();
    client.clear();
  });

  describe("given request deduplicate attribute is active", () => {
    describe("when initializing two hooks with the same request", () => {
      it("should send only one request", async () => {
        createRequestInterceptor(dedupeRequest);
        renderUseFetch(dedupeRequest);
        renderUseFetch(dedupeRequest);

        await waitForRender();

        expect(client.fetchDispatcher.getQueueRequestCount(dedupeRequest.queueKey)).toBe(1);
      });
      it("should deduplicate requests within deduplication time", async () => {
        createRequestInterceptor(dedupeRequest, { delay: 200 });

        renderUseFetch(dedupeRequest);
        await waitForRender(2);

        renderUseFetch(dedupeRequest);
        await waitForRender();

        expect(client.fetchDispatcher.getQueueRequestCount(dedupeRequest.queueKey)).toBe(1);
      });
    });
    describe("when response is failed", () => {
      it("should perform one retry on failure", async () => {
        const errorMock = createRequestInterceptor(dedupeRequest, { status: 400 });
        const responseOne = renderUseFetch(dedupeRequest);
        const responseTwo = renderUseFetch(dedupeRequest);

        await waitForRender();
        await testErrorState(errorMock, responseOne);
        await testErrorState(errorMock, responseTwo);

        const successMock = createRequestInterceptor(dedupeRequest);
        await testSuccessState(successMock, responseOne);
        await testSuccessState(successMock, responseTwo);

        expect(client.fetchDispatcher.getQueueRequestCount(dedupeRequest.queueKey)).toBe(2);
      });
    });
    describe("when response is successful", () => {
      it("should share the success data with all hooks", async () => {
        const mock = createRequestInterceptor(dedupeRequest);
        const responseOne = renderUseFetch(dedupeRequest);
        const responseTwo = renderUseFetch(dedupeRequest);

        await waitForRender();
        await testSuccessState(mock, responseOne);
        await testSuccessState(mock, responseTwo);
      });
    });
  });
});
