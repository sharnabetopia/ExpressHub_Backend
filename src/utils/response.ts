export type ApiResponse<T = null> = {
  success: boolean;
  message: string;
  data?: T | null;
  errors?: Array<string | Record<string, unknown>>;
};

export const sendSuccess = <T>(message: string, data: T | null = null): ApiResponse<T> => ({
  success: true,
  message,
  data,
});

export const sendError = (
  message: string,
  errors: Array<string | Record<string, unknown>> = [],
): ApiResponse<null> => ({
  success: false,
  message,
  errors,
});
