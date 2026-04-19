import AppDataSource from '@/config/database';
import { UserEntity } from '@/api/users/entities/user.entity';
import { OnboardingQuestionEntity } from '@/api/users/entities/onboarding-question.entity';

const userRepository = AppDataSource.getRepository(UserEntity);
export const onboardingQuestionRepository = AppDataSource.getRepository(OnboardingQuestionEntity);

export default userRepository;
