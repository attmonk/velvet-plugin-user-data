import { createUserDataManager, type UserDataManager } from './userDataManager';

export const VELVET_USER_DATA_PLUGIN_API_VERSION = 1 as const;

export interface VelvetUserDataPluginHost {
  apiVersion: number;
  pluginId: string;
  registerProvider(provider: UserDataManager): void;
}

export const activateUserDataPlugin = (host: VelvetUserDataPluginHost): void => {
  if (host.apiVersion !== VELVET_USER_DATA_PLUGIN_API_VERSION) {
    throw new Error(`Unsupported Velvet user-data plugin API version: ${host.apiVersion}`);
  }

  host.registerProvider(createUserDataManager());
};
