import { Module, NestModule, MiddlewareConsumer} from '@nestjs/common';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { ApiController } from './controllers/api.controller';
import { ConfigModule } from '@nestjs/config';
import { OpenAIService } from './services/openai.service';
import { TavilySearchService } from './services/tavily.service';
import { PlanAndExecuteGraph } from './services/langgraph.service';


@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, ApiController],
  providers: [AppService, OpenAIService, TavilySearchService, PlanAndExecuteGraph],
})

export class AppModule{}
