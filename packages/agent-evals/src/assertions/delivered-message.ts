import { evalMetadata, type EvalAssertion } from '../types'

const assertion: EvalAssertion = (_output, context) => {
  const delivered = evalMetadata(context)?.toolCalls.some(
    (call) => call.name === 'SendMessage' && call.result?.isError === false,
  ) ?? false
  return delivered
    ? { pass: true, score: 1, reason: 'PO delivered its response with SendMessage' }
    : { pass: false, score: 0, reason: 'PO did not call SendMessage' }
}

export default assertion
