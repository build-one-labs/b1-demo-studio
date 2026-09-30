import { createB1App } from '@buildone/app-server-tslib/framework';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await createB1App(AppModule);

  app.use(cookieParser());

  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
