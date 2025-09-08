import AppDataSource from '@/config/database';
import { UserEntity } from '@/api/users/entities/user.entity';

const userRepository = AppDataSource.getRepository(UserEntity);

export default userRepository;
