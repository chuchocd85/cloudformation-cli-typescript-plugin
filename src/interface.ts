import 'reflect-metadata';
import {
    ClientRequestToken,
    LogGroupName,
    LogicalResourceId,
    NextToken,
} from 'aws-sdk/clients/cloudformation';
import {
    classToPlain,
    ClassTransformOptions,
    Exclude,
    Expose,
    plainToClass,
} from 'class-transformer';

export type Optional<T> = T | undefined | null;
export type Dict<T = any> = Record<string, T>;
export type Constructor<T = {}> = new (...args: any[]) => T;
export type integer = bigint;

export interface Callable<R extends Array<any>, T> {
    (...args: R): T;
}

interface Integer extends BigInt {
    /**
     * Defines the default JSON representation of
     * Integer (BigInt) to be a number.
     */
    toJSON(): number;

    /** Returns the primitive value of the specified object. */
    valueOf(): integer;
}

interface IntegerConstructor extends BigIntConstructor {
    (value?: unknown): integer;
    readonly prototype: Integer;
    /**
     * Returns true if the value passed is a safe integer
     * to be parsed as number.
     * @param value An integer value.
     */
    isSafeInteger(value: unknown): boolean;
}

/**
 * Wrapper with additional JSON serialization for bigint type
 */
export const Integer: IntegerConstructor = new Proxy(BigInt, {
    apply(
        target: IntegerConstructor,
        _thisArg: unknown,
        argArray?: unknown[]
    ): integer {
        target.prototype.toJSON = function (): number {
            return Number(this.valueOf());
        };
        const isSafeInteger = (value: unknown): boolean => {
            if (
                value &&
                (value < BigInt(Number.MIN_SAFE_INTEGER) ||
                    value > BigInt(Number.MAX_SAFE_INTEGER))
            ) {
                return false;
            }
            return true;
        };
        target.isSafeInteger = isSafeInteger;
        const value = target(...argArray);
        if (value && !isSafeInteger(value)) {
            throw new RangeError(`Value is not a safe integer: ${value.toString()}`);
        }
        return value;
    },
}) as IntegerConstructor;

export enum Action {
    Create = 'CREATE',
    Read = 'READ',
    Update = 'UPDATE',
    Delete = 'DELETE',
    List = 'LIST',
}

export enum StandardUnit {
    Count = 'Count',
    Milliseconds = 'Milliseconds',
}

export enum MetricTypes {
    HandlerException = 'HandlerException',
    HandlerInvocationCount = 'HandlerInvocationCount',
    HandlerInvocationDuration = 'HandlerInvocationDuration',
}

export enum OperationStatus {
    Pending = 'PENDING',
    InProgress = 'IN_PROGRESS',
    Success = 'SUCCESS',
    Failed = 'FAILED',
}

export enum HandlerErrorCode {
    NotUpdatable = 'NotUpdatable',
    InvalidRequest = 'InvalidRequest',
    AccessDenied = 'AccessDenied',
    InvalidCredentials = 'InvalidCredentials',
    AlreadyExists = 'AlreadyExists',
    NotFound = 'NotFound',
    ResourceConflict = 'ResourceConflict',
    Throttling = 'Throttling',
    ServiceLimitExceeded = 'ServiceLimitExceeded',
    NotStabilized = 'NotStabilized',
    GeneralServiceException = 'GeneralServiceException',
    ServiceInternalError = 'ServiceInternalError',
    NetworkFailure = 'NetworkFailure',
    InternalFailure = 'InternalFailure',
}

export interface Credentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}

/**
 * Base class for data transfer objects that will contain
 * serialization and deserialization mechanisms.
 */
export abstract class BaseDto {
    constructor(partial?: unknown) {
        if (partial) {
            Object.assign(this, partial);
        }
    }

    @Exclude()
    static serializer = {
        classToPlain,
        plainToClass,
    };

    @Exclude()
    public serialize(removeNull = true): Dict {
        const data: Dict = JSON.parse(JSON.stringify(classToPlain(this)));
        // To match Java serialization, which drops 'null' values, and the
        // contract tests currently expect this also.
        if (removeNull) {
            for (const key in data) {
                const value = data[key];
                if (value == null) {
                    delete data[key];
                }
            }
        }
        return data;
    }

    public static deserialize<T extends BaseDto>(
        this: new () => T,
        jsonData: Dict,
        options: ClassTransformOptions = {}
    ): T {
        if (jsonData == null) {
            return null;
        }
        return plainToClass(this, jsonData, {
            enableImplicitConversion: false,
            excludeExtraneousValues: true,
            ...options,
        });
    }

    @Exclude()
    public toJSON(key?: string): Dict {
        return this.serialize();
    }
}

export interface RequestContext<T> {
    invocation: number;
    callbackContext: T;
    cloudWatchEventsRuleName: string;
    cloudWatchEventsTargetId: string;
}

export class BaseModel extends BaseDto {
    ['constructor']: typeof BaseModel;

    @Exclude()
    protected static readonly TYPE_NAME?: string;

    @Exclude()
    public getTypeName(): string {
        return Object.getPrototypeOf(this).constructor.TYPE_NAME;
    }
}

export class TestEvent extends BaseDto {
    @Expose() credentials: Credentials;
    @Expose() action: Action;
    @Expose() request: Dict;
    @Expose() callbackContext: Dict;
    @Expose() region?: string;
}

export class RequestData<T = Dict> extends BaseDto {
    @Expose() callerCredentials?: Credentials;
    @Expose() providerCredentials?: Credentials;
    @Expose() providerLogGroupName: LogGroupName;
    @Expose() logicalResourceId: LogicalResourceId;
    @Expose() resourceProperties: T;
    @Expose() previousResourceProperties?: T;
    @Expose() systemTags?: Dict<string>;
    @Expose() stackTags?: Dict<string>;
    @Expose() previousStackTags?: Dict<string>;
}

export class HandlerRequest<ResourceT = Dict, CallbackT = Dict> extends BaseDto {
    @Expose() action: Action;
    @Expose() awsAccountId: string;
    @Expose() bearerToken: string;
    @Expose() region: string;
    @Expose() responseEndpoint: string;
    @Expose() resourceType: string;
    @Expose() resourceTypeVersion: string;
    @Expose() requestData: RequestData<ResourceT>;
    @Expose() stackId: string;
    @Expose() callbackContext?: CallbackT;
    @Expose() nextToken?: NextToken;
    @Expose() requestContext: RequestContext<CallbackT>;
}

export class BaseResourceHandlerRequest<T extends BaseModel> extends BaseDto {
    @Expose() clientRequestToken: ClientRequestToken;
    @Expose() desiredResourceState?: T;
    @Expose() previousResourceState?: T;
    @Expose() desiredResourceTags: Dict<string>;
    @Expose() previousResourceTags: Dict<string>;
    @Expose() systemTags: Dict<string>;
    @Expose() awsAccountId: string;
    @Expose() awsPartition: string;
    @Expose() logicalResourceIdentifier?: LogicalResourceId;
    @Expose() nextToken?: NextToken;
    @Expose() region: string;
}

export class UnmodeledRequest extends BaseResourceHandlerRequest<BaseModel> {
    @Exclude()
    public static fromUnmodeled(obj: Dict): UnmodeledRequest {
        return UnmodeledRequest.deserialize(obj);
    }

    @Exclude()
    public static getPartition(region: Optional<string>): Optional<string> {
        if (!region) {
            return null;
        }
        if (region.startsWith('cn')) {
            return 'aws-cn';
        }
        if (region.startsWith('us-gov')) {
            return 'aws-gov';
        }
        return 'aws';
    }

    @Exclude()
    public toModeled<T extends BaseModel = BaseModel>(
        modelCls: Constructor<T> & { deserialize?: Function }
    ): BaseResourceHandlerRequest<T> {
        const request = BaseResourceHandlerRequest.deserialize<
            BaseResourceHandlerRequest<T>
        >({
            clientRequestToken: this.clientRequestToken,
            desiredResourceTags: this.desiredResourceTags,
            previousResourceTags: this.previousResourceTags,
            systemTags: this.systemTags,
            awsAccountId: this.awsAccountId,
            logicalResourceIdentifier: this.logicalResourceIdentifier,
            nextToken: this.nextToken,
            region: this.region,
            awsPartition: UnmodeledRequest.getPartition(this.region),
        });
        request.desiredResourceState = modelCls.deserialize(
            this.desiredResourceState || {}
        );
        request.previousResourceState = modelCls.deserialize(
            this.previousResourceState || {}
        );
        return request;
    }
}

export interface CfnResponse<T extends BaseModel> {
    errorCode?: HandlerErrorCode;
    status: OperationStatus;
    message: string;
    resourceModel?: T;
    resourceModels?: T[];
    nextToken?: NextToken;
}

export interface LambdaContext {
    invokedFunctionArn: string;
    getRemainingTimeInMillis(): number;
}
