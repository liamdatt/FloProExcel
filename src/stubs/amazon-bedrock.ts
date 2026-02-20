/**
 * Stub for Amazon Bedrock provider.
 *
 * Pi for Excel runs in a browser webview. The Bedrock provider pulls in AWS SDK
 * Node-only transports (`@smithy/node-http-handler`, Node `http`/`https`, etc.),
 * which breaks Vite production builds.
 *
 * If/when we want Bedrock support, we should add a browser-safe implementation
 * (SigV4 + fetch) or load this provider dynamically only in Node environments.
 */

export function streamBedrock(): never {
  throw new Error("Amazon Bedrock is not supported in the Excel add-in build.");
}

export function streamSimpleBedrock(): never {
  throw new Error("Amazon Bedrock is not supported in the Excel add-in build.");
}
