import AppDataSource from '@/config/database';
import { SystemSettingEntity } from '@/api/settings/entities/system-setting.entity';

export const systemSettingsRepository = AppDataSource.getRepository(SystemSettingEntity);
