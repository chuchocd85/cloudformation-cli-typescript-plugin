import CloudWatchEvents from 'aws-sdk/clients/cloudwatchevents';
import CloudFormation from 'aws-sdk/clients/cloudformation';

import * as exceptions from '../../src/exceptions';
import { ProgressEvent, SessionProxy } from '../../src/proxy';
import {
    Action,
    BaseResourceHandlerRequest,
    HandlerErrorCode,
    HandlerRequest,
    OperationStatus,
} from '../../src/interface';
import { ProviderLogHandler } from '../../src/log-delivery';
import { MetricsPublisherProxy } from '../../src/metrics';
import { handlerEvent, HandlerSignatures, BaseResource } from '../../src/resource';
import { SimpleStateModel } from '../data/sample-model';

const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
    });
};

jest.mock('aws-sdk/clients/cloudformation');
jest.mock('aws-sdk/clients/cloudwatchevents');
jest.mock('../../src/log-delivery');
jest.mock('../../src/metrics');

describe('when getting resource', () => {
    let entrypointPayload: any;
    let testEntrypointPayload: any;
    let mockSession: jest.SpyInstance;
    const TYPE_NAME = 'Test::Foo::Bar';
    class Resource extends BaseResource {}
    class MockModel extends SimpleStateModel {
        ['constructor']: typeof MockModel;
        public static readonly TYPE_NAME: string = TYPE_NAME;
    }

    beforeEach(() => {
        const mockEvents = (CloudWatchEvents as unknown) as jest.Mock;
        mockEvents.mockImplementation(() => {
            const returnValue = {
                deleteRule: mockResult({}),
                putRule: mockResult({}),
                putTargets: mockResult({}),
                removeTargets: mockResult({}),
            };
            return {
                ...returnValue,
                makeRequest: (operation: string, params?: { [key: string]: any }) => {
                    return returnValue[operation](params);
                },
            };
        });
        const mockCloudformation = (CloudFormation as unknown) as jest.Mock;
        mockCloudformation.mockImplementation(() => {
            const returnValue = {
                recordHandlerProgress: mockResult({}),
            };
            return {
                ...returnValue,
                makeRequest: (operation: string, params?: { [key: string]: any }) => {
                    return returnValue[operation](params);
                },
            };
        });
        entrypointPayload = {
            awsAccountId: '123456789012',
            bearerToken: '123456',
            region: 'us-east-1',
            action: 'CREATE',
            resourceType: 'AWS::Test::TestModel',
            resourceTypeVersion: '1.0',
            requestContext: {},
            requestData: {
                callerCredentials: {
                    accessKeyId: 'IASAYK835GAIFHAHEI23',
                    secretAccessKey: '66iOGPN5LnpZorcLr8Kh25u8AbjHVllv5/poh2O0',
                    sessionToken:
                        'lameHS2vQOknSHWhdFYTxm2eJc1JMn9YBNI4nV4mXue945KPL6DHfW8EsUQT5zwssYEC1NvYP9yD6Y5s5lKR3chflOHPFsIe6eqg',
                },
                providerCredentials: {
                    accessKeyId: 'HDI0745692Y45IUTYR78',
                    secretAccessKey: '4976TUYVI234/5GW87ERYG823RF87GY9EIUH452I3',
                    sessionToken:
                        '842HYOFIQAEUDF78R8T7IU43HSADYGIFHBJSDHFA87SDF9PYvN1CEYASDUYFT5TQ97YASIHUDFAIUEYRISDKJHFAYSUDTFSDFADS',
                },
                providerLogGroupName: 'providerLoggingGroupName',
                logicalResourceId: 'myBucket',
                resourceProperties: { state: 'state1' },
                previousResourceProperties: { state: 'state2' },
                stackTags: { tag1: 'abc' },
                previousStackTags: { tag1: 'def' },
            },
            stackId:
                'arn:aws:cloudformation:us-east-1:123456789012:stack/SampleStack/e722ae60-fe62-11e8-9a0e-0ae8cc519968',
        };
        testEntrypointPayload = {
            credentials: {
                accessKeyId: '',
                secretAccessKey: '',
                sessionToken: '',
            },
            action: 'CREATE',
            request: {
                clientRequestToken: 'ecba020e-b2e6-4742-a7d0-8a06ae7c4b2b',
                desiredResourceState: { state: 'state1' },
                previousResourceState: { state: 'state2' },
                logicalResourceIdentifier: null,
            },
        };
        mockSession = jest.spyOn(SessionProxy, 'getSession').mockImplementation(() => {
            return new SessionProxy({});
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    const getResource = (handlers?: HandlerSignatures) => {
        const instance = new Resource(TYPE_NAME, null, handlers);
        return instance;
    };

    test('entrypoint handler error', async () => {
        const resource = getResource();
        const event = await resource.entrypoint({}, null);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InvalidRequest);
    });

    test('entrypoint success', async () => {
        const mockLogDelivery: jest.Mock = (ProviderLogHandler.setup as unknown) as jest.Mock;
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(TYPE_NAME, MockModel);
        resource.addHandler(Action.Create, mockHandler);
        const event = await resource.entrypoint(entrypointPayload, null);
        expect(mockLogDelivery).toBeCalledTimes(1);
        expect(event).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
        expect(mockHandler).toBeCalledTimes(1);
    });

    test('entrypoint handler raises', async () => {
        const resource = new Resource(TYPE_NAME, MockModel);
        const mockPublishException = (MetricsPublisherProxy.prototype
            .publishExceptionMetric as unknown) as jest.Mock;
        const mockInvokeHandler = jest.spyOn<typeof resource, any>(
            resource,
            'invokeHandler'
        );
        mockInvokeHandler.mockImplementation(() => {
            throw new exceptions.InvalidRequest('handler failed');
        });
        const event = await resource.entrypoint(entrypointPayload, null);
        expect(mockPublishException).toBeCalledTimes(1);
        expect(mockInvokeHandler).toBeCalledTimes(1);
        expect(event).toMatchObject({
            errorCode: 'InvalidRequest',
            message: 'Error: handler failed',
            status: OperationStatus.Failed,
            callbackDelaySeconds: 0,
        });
    });

    test('entrypoint non mutating action', async () => {
        const resource = new Resource(TYPE_NAME, MockModel);
        entrypointPayload['action'] = 'READ';
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        resource.addHandler(Action.Create, mockHandler);
        await resource.entrypoint(entrypointPayload, null);
    });

    test('entrypoint with callback context', async () => {
        entrypointPayload['callbackContext'] = { a: 'b' };
        const event: ProgressEvent = ProgressEvent.success(null, { c: 'd' });
        const mockHandler: jest.Mock = jest.fn(() => event);
        const resource = new Resource(TYPE_NAME, MockModel);
        resource.addHandler(Action.Create, mockHandler);
        const response = await resource.entrypoint(entrypointPayload, null);
        expect(response).toMatchObject({
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        });
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(
            expect.any(SessionProxy),
            expect.any(BaseResourceHandlerRequest),
            entrypointPayload['callbackContext']
        );
    });

    test('entrypoint without callback context', async () => {
        entrypointPayload['callbackContext'] = null;
        const mockLogDelivery: jest.Mock = (ProviderLogHandler.setup as unknown) as jest.Mock;
        const event: ProgressEvent = ProgressEvent.progress(null, { c: 'd' });
        event.callbackDelaySeconds = 5;
        const mockHandler: jest.Mock = jest.fn(() => event);
        const resource = new Resource(TYPE_NAME, MockModel);
        resource.addHandler(Action.Create, mockHandler);
        const response = await resource.entrypoint(entrypointPayload, null);
        expect(mockLogDelivery).toBeCalledTimes(1);
        expect(response).toMatchObject({
            message: '',
            status: OperationStatus.InProgress,
            callbackDelaySeconds: 5,
            callbackContext: { c: 'd' },
        });
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(
            expect.any(SessionProxy),
            expect.any(BaseResourceHandlerRequest),
            {}
        );
    });

    test('entrypoint success without caller provider creds', async () => {
        const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.success());
        const resource = new Resource(TYPE_NAME, MockModel);
        resource.addHandler(Action.Create, mockHandler);
        const expected = {
            message: '',
            status: OperationStatus.Success,
            callbackDelaySeconds: 0,
        };
        // Credentials are defined in payload, but null.
        entrypointPayload['requestData']['providerCredentials'] = null;
        entrypointPayload['requestData']['callerCredentials'] = null;
        let response = await resource.entrypoint(entrypointPayload, null);
        expect(response).toMatchObject(expected);

        // Credentials are undefined in payload.
        delete entrypointPayload['requestData']['providerCredentials'];
        delete entrypointPayload['requestData']['callerCredentials'];
        response = await resource.entrypoint(entrypointPayload, null);
        expect(response).toMatchObject(expected);
    });

    test('parse request invalid request', () => {
        const parseRequest = () => {
            Resource['parseRequest']({});
        };
        expect(parseRequest).toThrow(exceptions.InvalidRequest);
        expect(parseRequest).toThrow(/missing.+awsAccountId/i);
    });

    test('parse request with object literal callback context', () => {
        const callbackContext = { a: 'b' };
        entrypointPayload['callbackContext'] = { a: 'b' };
        const resource = getResource();
        const [sessions, action, callback, request] = resource.constructor[
            'parseRequest'
        ](entrypointPayload);
        expect(sessions).toBeDefined();
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('parse request with map callback context', () => {
        const callbackContext = { a: 'b' };
        entrypointPayload['callbackContext'] = callbackContext;
        const resource = getResource();
        const [sessions, action, callback, request] = resource.constructor[
            'parseRequest'
        ](entrypointPayload);
        expect(sessions).toBeDefined();
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('cast resource request invalid request', () => {
        const request = HandlerRequest.deserialize(entrypointPayload);
        request.requestData = null;
        const resource = getResource();
        const castResourceRequest = () => {
            resource['castResourceRequest'](request);
        };
        expect(castResourceRequest).toThrow(exceptions.InvalidRequest);
        expect(castResourceRequest).toThrow('TypeError: Cannot read property');
    });

    test('parse request valid request and cast resource request', () => {
        const spyDeserialize: jest.SpyInstance = jest.spyOn(MockModel, 'deserialize');
        const resource = new Resource(TYPE_NAME, MockModel);

        const [sessions, action, callback, request] = resource.constructor[
            'parseRequest'
        ](entrypointPayload);

        expect(mockSession).toBeCalledTimes(2);
        expect(mockSession).nthCalledWith(
            1,
            entrypointPayload['requestData']['callerCredentials']
        );
        expect(mockSession).nthCalledWith(
            2,
            entrypointPayload['requestData']['providerCredentials']
        );
        // Credentials are used when rescheduling, so can't zero them out (for now).
        expect(request.requestData.callerCredentials).not.toBeNull();
        expect(request.requestData.providerCredentials).not.toBeNull();

        const [callerSession, providerSession] = sessions;
        expect(mockSession).nthReturnedWith(1, callerSession);
        expect(mockSession).nthReturnedWith(2, providerSession);

        expect(action).toBe(Action.Create);
        expect(callback).toMatchObject({});

        const modeledRequest = resource['castResourceRequest'](request);
        expect(spyDeserialize).nthCalledWith(1, { state: 'state1' });
        expect(spyDeserialize).nthCalledWith(2, { state: 'state2' });
        expect(modeledRequest).toMatchObject({
            clientRequestToken: request.bearerToken,
            desiredResourceState: { state: 'state1' },
            previousResourceState: { state: 'state2' },
            desiredResourceTags: request.requestData.stackTags,
            previousResourceTags: request.requestData.previousStackTags,
            systemTags: request.requestData.systemTags,
            awsAccountId: request.awsAccountId,
            logicalResourceIdentifier: 'myBucket',
            region: request.region,
            awsPartition: 'aws',
        });
    });

    test('entrypoint uncaught exception', async () => {
        const mockParseRequest = jest.spyOn<any, any>(BaseResource, 'parseRequest');
        mockParseRequest.mockImplementationOnce(() => {
            throw new Error('exception');
        });
        const resource = getResource();
        const event = await resource.entrypoint({}, null);
        expect(mockParseRequest).toBeCalledTimes(1);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InternalFailure);
        expect(event.message).toBe('exception');
    });

    test('add handler', () => {
        class ResourceEventHandler extends BaseResource {
            @handlerEvent(Action.Create)
            public create(): void {}
            @handlerEvent(Action.Read)
            public read(): void {}
            @handlerEvent(Action.Update)
            public update(): void {}
            @handlerEvent(Action.Delete)
            public delete(): void {}
            @handlerEvent(Action.List)
            public list(): void {}
        }
        const handlers: HandlerSignatures = new HandlerSignatures();
        const resource = new ResourceEventHandler(null, null, handlers);
        expect(resource['handlers'].get(Action.Create)).toBe(resource.create);
        expect(resource['handlers'].get(Action.Read)).toBe(resource.read);
        expect(resource['handlers'].get(Action.Update)).toBe(resource.update);
        expect(resource['handlers'].get(Action.Delete)).toBe(resource.delete);
        expect(resource['handlers'].get(Action.List)).toBe(resource.list);
    });

    test('check resource instance and type name', async () => {
        class ResourceEventHandler extends BaseResource<MockModel> {
            @handlerEvent(Action.Create)
            public async create(): Promise<ProgressEvent> {
                const progress: ProgressEvent<MockModel> = ProgressEvent.builder()
                    .message(this.typeName)
                    .status(OperationStatus.Success)
                    .resourceModels([])
                    .build() as ProgressEvent<MockModel>;
                return progress;
            }
        }
        const spyCreate = jest.spyOn(ResourceEventHandler.prototype, 'create');
        const handlers: HandlerSignatures = new HandlerSignatures();
        const resource = new ResourceEventHandler(TYPE_NAME, MockModel, handlers);
        const event = await resource.testEntrypoint(testEntrypointPayload, null);
        expect(spyCreate).toHaveReturnedTimes(1);
        expect(event.status).toBe(OperationStatus.Success);
        expect(event.message).toBe(TYPE_NAME);
    });

    test('invoke handler not found', async () => {
        const resource = getResource();
        const callbackContext = {};
        const actual = await resource['invokeHandler'](
            null,
            null,
            Action.Create,
            callbackContext
        );
        const expected = ProgressEvent.failed(
            HandlerErrorCode.InternalFailure,
            'No handler for CREATE'
        );
        expect(actual).toStrictEqual(expected);
    });

    test('invoke handler was found', async () => {
        const event: ProgressEvent = ProgressEvent.progress();
        const mockHandler: jest.Mock = jest.fn(() => event);
        const handlers: HandlerSignatures = new HandlerSignatures();
        handlers.set(Action.Create, mockHandler);
        const resource = getResource(handlers);
        const session = new SessionProxy({});
        const request = new BaseResourceHandlerRequest();
        const callbackContext = {};
        const response = await resource['invokeHandler'](
            session,
            request,
            Action.Create,
            callbackContext
        );
        expect(response).toBe(event);
        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith(session, request, callbackContext);
    });

    test('invoke handler non mutating must be synchronous', () => {
        [Action.List, Action.Read].forEach((action: Action) => {
            const mockHandler: jest.Mock = jest.fn(() => ProgressEvent.progress());
            const handlers: HandlerSignatures = new HandlerSignatures();
            handlers.set(action, mockHandler);
            const resource = getResource(handlers);
            const callbackContext = {};
            expect(
                resource['invokeHandler'](null, null, action, callbackContext)
            ).rejects.toEqual(
                new exceptions.InternalFailure(
                    'READ and LIST handlers must return synchronously.'
                )
            );
        });
    });

    test('parse test request invalid request', () => {
        const resource = getResource();
        const parseTestRequest = () => {
            resource['parseTestRequest']({});
        };
        expect(parseTestRequest).toThrow(exceptions.InternalFailure);
        expect(parseTestRequest).toThrow(/missing.+credentials/i);
    });

    test('parse test request with object literal callback context', () => {
        const callbackContext = { a: 'b' };
        testEntrypointPayload['callbackContext'] = callbackContext;
        const resource = new Resource(TYPE_NAME, MockModel);
        const [session, request, action, callback] = resource['parseTestRequest'](
            testEntrypointPayload
        );
        expect(session).toBeDefined();
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('parse test request with map callback context', () => {
        const callbackContext = { a: 'b' };
        testEntrypointPayload['callbackContext'] = callbackContext;
        const resource = new Resource(TYPE_NAME, MockModel);
        const [session, request, action, callback] = resource['parseTestRequest'](
            testEntrypointPayload
        );
        expect(session).toBeDefined();
        expect(action).toBeDefined();
        expect(callback).toMatchObject(callbackContext);
        expect(request).toBeDefined();
    });

    test('parse test request valid request', () => {
        const resource = new Resource(TYPE_NAME, MockModel);
        resource.addHandler(Action.Create, jest.fn());
        const [session, request, action, callback] = resource['parseTestRequest'](
            testEntrypointPayload
        );

        expect(mockSession).toBeCalledTimes(1);
        expect(mockSession).toHaveReturnedWith(session);

        expect(request).toMatchObject({
            clientRequestToken: 'ecba020e-b2e6-4742-a7d0-8a06ae7c4b2b',
            desiredResourceState: { state: 'state1' },
            previousResourceState: { state: 'state2' },
            logicalResourceIdentifier: null,
        });

        expect(action).toBe(Action.Create);
        expect(callback).toMatchObject({});
    });

    test('test entrypoint handler error', async () => {
        const resource = getResource();
        const event: ProgressEvent = await resource.testEntrypoint({}, null);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InternalFailure);
    });

    test('test entrypoint uncaught exception', async () => {
        const resource = getResource();
        const mockParseRequest = jest.spyOn<any, any>(resource, 'parseTestRequest');
        mockParseRequest.mockImplementationOnce(() => {
            throw new Error('exception');
        });
        const event: ProgressEvent = await resource.testEntrypoint({}, null);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(HandlerErrorCode.InternalFailure);
        expect(event.message).toBe('exception');
    });

    test('test entrypoint success', async () => {
        const spyDeserialize: jest.SpyInstance = jest.spyOn(MockModel, 'deserialize');
        const resource = new Resource(TYPE_NAME, MockModel);

        const progressEvent: ProgressEvent = ProgressEvent.progress();
        const mockHandler: jest.Mock = jest.fn(() => progressEvent);
        resource.addHandler(Action.Create, mockHandler);
        const event = await resource.testEntrypoint(testEntrypointPayload, null);
        expect(event).toBe(progressEvent);

        expect(spyDeserialize).nthCalledWith(1, { state: 'state1' });
        expect(spyDeserialize).nthCalledWith(2, { state: 'state2' });
        expect(mockHandler).toBeCalledTimes(1);
    });
});
