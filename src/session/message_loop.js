const vm = require('vm');

const { SessionBasicRequestTypes } = require('./requests/base');
const { SessionExecuteCodeRequest } = require('./requests/execute_code');
const { SessionExecuteCodeResponse } = require('./responses/execute_code');

class MessageLoop {
    constructor(hostPort) {
        this._parentPort = hostPort;
        this._handlers = {
            [SessionBasicRequestTypes.ExecuteCode]: SessionExecuteCodeRequest
        };
        this._context = vm.createContext({
            ...global, Promise,
            kernel: () => {
                console.log("called kernel");
            }
        });
    }
    
    start() {
        this._parentPort.on("message", msg => this._handleMessage(msg));
        this._parentPort.on("error", error => {
            // TODO: refactor this message
            // this._parentPort.postMessage({
            //     stderr: error.stack.toString()
            // });
            console.error("Need to implement error handling on the node-session side.");
        });
    }

    _handleMessage({id, type, args}) {
        if (type === SessionBasicRequestTypes.ExecuteCode) {
            let resultMimeType = 'text/plain';
            let promisedEvalResult;
            
            try {
                let rawEvalResult = vm.runInContext(args.code, this._context);

                if (rawEvalResult instanceof Promise) {
                    promisedEvalResult = rawEvalResult.then(resolvedResult => {
                        let innerPromisedEvalResult;

                        // Note: don't use instanceOf. It looks like Object and Function is not part of the execution context
                        //       even though Promise is
                        if (typeof resolvedResult === 'object' && typeof resolvedResult._toHtml === 'function') {
                            let resolvedResultOfHtml = resolvedResult._toHtml();

                            resultMimeType = 'text/html';
                            if (resolvedResultOfHtml instanceof Promise) {
                                innerPromisedEvalResult = resolvedResultOfHtml;
                            } else {
                                innerPromisedEvalResult = Promise.resolve(resolvedResultOfHtml);
                            }
                        } else {
                            innerPromisedEvalResult = Promise.resolve(resolvedResult);
                        }

                        return innerPromisedEvalResult;
                    });
                } else {
                    promisedEvalResult = Promise.resolve(rawEvalResult);
                }
            } catch (err) {
                // TODO
                promisedEvalResult = Promise.resolve(undefined);
            }

            promisedEvalResult.then(evalResult => {
                if (evalResult !== undefined) {
                    evalResult = `${evalResult}`;
                }
                new SessionExecuteCodeResponse(id, args.executionCount, resultMimeType, evalResult).replyTo(this._parentPort);
            });
        }
    }
}

module.exports = { MessageLoop };