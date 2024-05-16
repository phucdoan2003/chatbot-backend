import { Controller, Post, Body, Res } from '@nestjs/common';
import { AppService } from 'src/app.service';
import { ChatOpenAI } from '@langchain/openai';


@Controller('api')
export class ApiController {

  constructor(private readonly appService: AppService) {}

  @Post('post-message') 
  async postMessage(@Body() data: any, @Res() res: any): Promise<any> { 

    const chatModel = new ChatOpenAI();
    
    const answer = await chatModel.invoke(data.message);
    console.log(answer)
    res.status(200).send({ message: answer.content });

    return {message: 'POST request received'};
  }
}