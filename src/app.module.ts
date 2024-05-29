import { Module, NestModule, MiddlewareConsumer} from '@nestjs/common';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { ApiController } from './controllers/api.controller';
import { ConfigModule } from '@nestjs/config';
import { OpenAIService } from './services/openai.service';
import { TavilySearchService } from './services/tavily.service';
import { LLMCompilerGraph } from './services/langgraph.service';
import { SupabaseService } from './services/supabase.service';


@Module({
  imports: [ConfigModule.forRoot()],
  controllers: [AppController, ApiController],
  providers: [AppService, OpenAIService, TavilySearchService, LLMCompilerGraph, SupabaseService],
})

export class AppModule{}
