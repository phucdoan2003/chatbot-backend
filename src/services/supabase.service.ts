import { Injectable } from "@nestjs/common";
import { SupabaseVectorStore } from "@langchain/community/vectorstores/supabase"
import { OpenAIEmbeddings } from "@langchain/openai";
import { createClient } from "@supabase/supabase-js";

@Injectable()
export class SupabaseService {
    
}