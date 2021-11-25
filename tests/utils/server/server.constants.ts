import { FetchBuilder } from "middleware";

export type ErrorCodesType = 400 | 401 | 404 | 500;
export type ErrorMockType = { message: string };

export const errorResponses: Record<ErrorCodesType, ErrorMockType> = {
  401: {
    message: "Unathorized",
  },
  400: {
    message: "Error",
  },
  404: {
    message: "Not found",
  },
  500: {
    message: "Server Error",
  },
};

export const testMiddleware = new FetchBuilder<ErrorMockType>({ baseUrl: "http://localhost:3000" }).build();