import {CalculateChatRequest} from "../data/CalculateChatRequest";
import {
    DefaultOpenAiMessageMapper,
    factory,
    OpenAiAssistantConfig,
    OpenAiChatState, OpenAiMessageMapper,
    ToolsDispatcher,
    UserMessageParts
} from "@motorro/firebase-ai-chat-openai";
import {PostCalculateRequest} from "../data/PostCalculateRequest";
import {CalculateChatData} from "../data/CalculateChatData";
import {firestore} from "firebase-admin";
import CollectionReference = firestore.CollectionReference;
import {NAME, openAiApiKey, openAiAssistantId, region} from "../env";
import {getFunctions} from "firebase-admin/functions";
import {CalculateChatResponse} from "../data/CalculateChatResponse";
import DocumentReference = firestore.DocumentReference;
import {ChatWorker, MessageMiddleware, NewMessage} from "@motorro/firebase-ai-chat-core";
import OpenAI from "openai";
import {calculateDispatcher, handOverProcessor, parseOperation} from "../common/calculator";
import {CloseCalculateRequest} from "../data/CloseCalculateRequest";
import {CHATS} from "../data/Collections";
import {CalculatorMeta} from "../data/MessageMeta";
import {Message} from "openai/src/resources/beta/threads/messages";
import {commandSchedulers} from "../common/commandSchedulers";

const db = firestore();
const chats = db.collection(CHATS) as CollectionReference<OpenAiChatState<CalculateChatData>>;
const chatFactory = factory(db, getFunctions(), region, undefined, undefined, true, true);
const assistantChat = chatFactory.chat<CalculateChatData>("calculator", commandSchedulers);
// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const dispatchers: Record<string, ToolsDispatcher<any, any, any>> = {
    [NAME]: calculateDispatcher
};

export const calculate = async (uid: string, data: CalculateChatRequest): Promise<CalculateChatResponse> => {
    const chat = chats.doc();
    const config: OpenAiAssistantConfig = {
        engine: "openai",
        assistantId: openAiAssistantId.value(),
        dispatcherId: NAME
    };
    const result = await assistantChat.create(
        chat,
        uid,
        {sum: 0},
        config,
        [data.message],
        undefined,
        <CalculatorMeta>{
            aiMessageMeta: {
                name: NAME,
                engine: "OpenAi"
            }
        }
    );
    return {
        chatDocument: chat.path,
        status: result.status,
        data: result.data
    };
};

export const postToCalculate = async (uid: string, data: PostCalculateRequest): Promise<CalculateChatResponse> => {
    const result = await assistantChat.postMessage(
        db.doc(data.chatDocument) as DocumentReference<OpenAiChatState<CalculateChatData>>,
        uid,
        [data.message]
    );
    return {
        chatDocument: data.chatDocument,
        status: result.status,
        data: result.data
    };
};

export const closeCalculate = async (uid: string, data: CloseCalculateRequest): Promise<CalculateChatResponse> => {
    const result = await assistantChat.closeChat(
        db.doc(data.chatDocument) as DocumentReference<OpenAiChatState<CalculateChatData>>,
        uid,
    );
    return {
        chatDocument: data.chatDocument,
        status: result.status,
        data: result.data
    };
};

const messageMapper: OpenAiMessageMapper = {
    toAi: function(message: NewMessage): UserMessageParts {
        return DefaultOpenAiMessageMapper.toAi(message);
    },
    fromAi: function(message: Message): NewMessage | undefined {
        const parts: Array<string> = [];
        for (const content of message.content) {
            if ("text" === content.type) {
                parts.push(content.text.value);
            }
        }
        return parseOperation(parts.join("\n"));
    }
};

export const getWorker = (): ChatWorker => {
    const handOver: MessageMiddleware<CalculateChatData, CalculatorMeta> = chatFactory.handOverMiddleware(
        "calculator",
        handOverProcessor,
        commandSchedulers
    );
    return chatFactory.worker(
        new OpenAI({apiKey: openAiApiKey.value()}),
        dispatchers,
        messageMapper,
        undefined,
        [handOver],
        commandSchedulers
    );
};

