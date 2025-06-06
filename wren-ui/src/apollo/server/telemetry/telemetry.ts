import { getConfig } from '../config';
import { PostHog } from 'posthog-node';
import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '@server/utils';
import { IContext } from '../types';

const logger = getLogger('TELEMETRY');
logger.level = 'debug';

const config = getConfig();

const {
  userUUID,
  telemetryEnabled,
  wrenAIVersion,
  generationModel,
  wrenEngineVersion,
  wrenUIVersion,
  posthogApiKey,
  posthogHost,
} = config;

export enum TelemetryEvent {
  // onboarding
  CONNECTION_START_SAMPLE_DATASET = 'connection_start_sample_dataset',
  CONNECTION_SAVE_DATA_SOURCE = 'connection_save_data_source',
  CONNECTION_SAVE_TABLES = 'connection_save_tables',
  CONNECTION_SAVE_RELATION = 'connection_save_relation',

  // modeling page
  MODELING_DEPLOY_MDL = 'modeling_deploy_mdl',
  MODELING_CREATE_MODEL = 'modeling_create_model',
  MODELING_UPDATE_MODEL = 'modeling_update_model',
  MODELING_CREATE_CF = 'modeling_create_cf',
  MODELING_UPDATE_CF = 'modeling_update_cf',
  MODELING_UPDATE_MODEL_METADATA = 'modeling_update_model_metadata',
  MODELING_UPDATE_VIEW_METADATA = 'modeling_update_view_metadata',
  MODELING_CREATE_RELATION = 'modeling_create_relation',
  MODELING_UPDATE_RELATION = 'modeling_update_relation',
  // schema change
  MODELING_DETECT_SCHEMA_CHANGE = 'modeling_detect_schema_change',
  MODELING_RESOLVE_SCHEMA_CHANGE = 'modeling_resolve_schema_change',

  HOME_UPDATE_THREAD_SUMMARY = 'update_thread_summary',
  // ask question
  HOME_ASK_CANDIDATE = 'home_ask_candidate',
  HOME_CREATE_THREAD = 'home_create_thread',
  HOME_ANSWER_QUESTION = 'home_answer_question',
  HOME_ANSWER_QUESTION_INTERRUPTED = 'home_answer_question_interrupted',
  HOME_ANSWER_BREAKDOWN = 'home_answer_breakdown',
  HOME_ANSWER_CHART = 'home_answer_chart',
  HOME_ANSWER_ADJUST_CHART = 'home_answer_adjust_chart',
  HOME_ASK_FOLLOWUP_QUESTION = 'home_ask_followup_question',
  HOME_CANCEL_ASK = 'home_cancel_ask',
  HOME_RERUN_ASKING_TASK = 'home_rerun_asking_task',
  HOME_GENERATE_PROJECT_RECOMMENDATION_QUESTIONS = 'home_generate_project_recommendation_questions',
  HOME_GENERATE_THREAD_RECOMMENDATION_QUESTIONS = 'home_generate_thread_recommendation_questions',

  // adjustment
  HOME_ADJUST_THREAD_RESPONSE = 'home_adjust_thread_response',
  HOME_ADJUST_THREAD_RESPONSE_CANCEL = 'home_adjust_thread_response_cancel',
  HOME_ADJUST_THREAD_RESPONSE_RERUN = 'home_adjust_thread_response_rerun',
  HOME_ADJUST_THREAD_RESPONSE_WITH_SQL = 'home_adjust_thread_response_with_sql',

  // event after ask
  HOME_CREATE_VIEW = 'home_create_view',
  HOME_PREVIEW_ANSWER = 'home_preview_answer',

  // settings event
  SETTING_RESET_PROJECT = 'setting_reset_project',

  // ibis event
  IBIS_DRY_RUN = 'ibis_dry_run',
  IBIS_QUERY = 'ibis_query',

  // Default error
  GRAPHQL_ERROR = 'graphql_error',

  // Knowledge
  KNOWLEDGE_CREATE_INSTRUCTION = 'knowledge_create_instruction',
  KNOWLEDGE_UPDATE_INSTRUCTION = 'knowledge_update_instruction',
  KNOWLEDGE_DELETE_INSTRUCTION = 'knowledge_delete_instruction',
  KNOWLEDGE_CREATE_SQL_PAIR = 'knowledge_create_sql_pair',
  KNOWLEDGE_UPDATE_SQL_PAIR = 'knowledge_update_sql_pair',
  KNOWLEDGE_DELETE_SQL_PAIR = 'knowledge_delete_sql_pair',
}

export enum WrenService {
  BE = 'BE',
  AI = 'AI',
  ENGINE = 'ENGINE',
  UNKNOWN = 'UNKNOWN',
}

export interface ITelemetry {
  sendEvent: (
    event: TelemetryEvent,
    properties: Record<string, any>,
    service?: WrenService | any,
    actionSuccess?: boolean,
  ) => void;
}

export class PostHogTelemetry {
  private readonly posthog: any;
  private readonly userId: string;

  constructor() {
    if (telemetryEnabled) {
      if (!posthogApiKey) {
        logger.debug('Telemetry enabled but posthogApiKey not provided.');
        return;
      }
      const client = new PostHog(posthogApiKey, {
        host: posthogHost || 'https://us.posthog.com',
      });
      this.posthog = client;
      this.userId = userUUID || uuidv4();
      logger.info(`Telemetry initialized: ${this.userId}`);
      return;
    }
    logger.info('Telemetry not enabled.');
  }

  public async sendEvent(
    event: TelemetryEvent,
    properties: Record<string, any> = {},
    service: WrenService | any = WrenService.UNKNOWN,
    actionSuccess: boolean = true,
  ) {
    if (!this.posthog) {
      return;
    }
    const eventName = actionSuccess ? `${event}_success` : `${event}_failed`;
    try {
      console.log('sendEvent', eventName, properties, service, actionSuccess);
      const systemInfo = this.collectSystemInfo();
      this.posthog.capture({
        distinctId: this.userId,
        event: eventName,
        properties: {
          ...systemInfo,
          ...properties,
          wren_service: service,
        },
      });
    } catch (e) {
      logger.error(e);
    }
  }

  private collectSystemInfo(): Record<string, any> {
    return {
      // collect services version
      'wren-ui-version': wrenUIVersion || null,
      'wren-engine-version': wrenEngineVersion || null,
      'wren-ai-service-version': wrenAIVersion || null,

      // collect AI model info
      'generation-model': generationModel || null,

      // collect some system info from process module
      node_version: process.version,
      node_platform: process.platform,
      node_arch: process.arch,
      memory_usage: process.memoryUsage(),
      cpu_usage: process.cpuUsage(),
    };
  }

  public stop() {
    if (this.posthog) {
      this.posthog.shutdown();
    }
  }
}

export const withTelemetry = async <T>(
  eventName: TelemetryEvent,
  data: any,
  operation: () => Promise<T>,
  ctx: IContext,
): Promise<T> => {
  try {
    const result = await operation();
    ctx.telemetry.sendEvent(eventName, { data });
    return result;
  } catch (err: any) {
    ctx.telemetry.sendEvent(
      eventName,
      { data, error: err.message },
      err.extensions?.service,
      false,
    );
    throw err;
  }
};

export function TrackTelemetry(eventName: TelemetryEvent) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: [any, any, IContext]) {
      // The last argument is typically the context in GraphQL resolvers
      const [, , ctx] = args;
      // Extract data using the provided extractor or use a default approach
      const data = args[1]?.data || args[1];

      try {
        const result = await originalMethod.apply(this, args);
        ctx.telemetry.sendEvent(eventName, { data });
        return result;
      } catch (err: any) {
        ctx.telemetry.sendEvent(
          eventName,
          { data, error: err.message },
          err.extensions?.service,
          false,
        );
        throw err;
      }
    };

    return descriptor;
  };
}
