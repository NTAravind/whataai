"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Upload } from "lucide-react";
import { Input } from "@/components/ui/input";

export interface PendingTemplatePayload {
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  components: any[];
  waAccountId?: string;
  subCategory?: string;
}

interface WhatsAppTemplatePreviewProps {
  template: PendingTemplatePayload;
  onApprove: (template: PendingTemplatePayload) => void;
  onEdit: (feedback: string) => void;
  submitting?: boolean;
}

export function WhatsAppTemplatePreview({
  template,
  onApprove,
  onEdit,
  submitting = false,
}: WhatsAppTemplatePreviewProps) {
  const [feedback, setFeedback] = useState("");
  
  // Quick and dirty parser for variables ({{1}}, {{2}})
  const replaceVars = (text: string) => {
    return text.replace(/\{\{\d+\}\}/g, "[variable]");
  };

  const header = template.components.find((c) => c.type === "HEADER");
  const body = template.components.find((c) => c.type === "BODY");
  const footer = template.components.find((c) => c.type === "FOOTER");
  const buttons = template.components.find((c) => c.type === "BUTTONS");

  return (
    <div className="flex flex-col space-y-4 my-4 max-w-sm">
      <Card className="bg-[#EFEAE2] border-none overflow-hidden relative">
        <div className="bg-[#075E54] text-white p-3 font-semibold flex items-center">
          <div className="w-8 h-8 rounded-full bg-white/20 mr-3"></div>
          Business Name
        </div>
        
        <div className="p-4 space-y-2 relative bg-[url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')] bg-cover">
          <div className="bg-white p-3 rounded-lg rounded-tl-none shadow-sm relative z-10 w-fit max-w-[90%]">
            {header?.format === "IMAGE" && (
              <div className="bg-gray-200 h-32 rounded-md mb-2 flex items-center justify-center flex-col text-gray-500 cursor-pointer hover:bg-gray-300">
                <Upload size={24} className="mb-1" />
                <span className="text-xs">Upload Header Image</span>
                {/* Simulated file upload - in real app, we'd upload to Supabase storage */}
              </div>
            )}
            {header?.format === "VIDEO" && (
              <div className="bg-gray-200 h-32 rounded-md mb-2 flex items-center justify-center flex-col text-gray-500 cursor-pointer hover:bg-gray-300">
                <Upload size={24} className="mb-1" />
                <span className="text-xs">Upload Header Video</span>
              </div>
            )}
            {header?.format === "TEXT" && (
              <div className="font-bold mb-1">{header.text}</div>
            )}
            
            <div className="text-sm whitespace-pre-wrap text-gray-800">
              {replaceVars(body?.text || "")}
            </div>
            
            {footer && (
              <div className="text-xs text-gray-500 mt-2 uppercase">
                {footer.text}
              </div>
            )}
          </div>

          {buttons && (
            <div className="flex flex-col space-y-1 mt-2 z-10 relative">
              {buttons.buttons.map((btn: any, i: number) => (
                <div key={i} className="bg-white rounded-lg p-2 text-center text-[#00a884] font-medium text-sm shadow-sm">
                  {btn.type === "QUICK_REPLY" ? btn.text : btn.text}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
      
      <div className="space-y-2">
        <Textarea 
          placeholder="Want changes? Type here..."
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          className="resize-none"
        />
        <div className="flex space-x-2">
          <Button 
            variant="outline" 
            className="w-full"
            onClick={() => {
              if (!feedback.trim()) return;
              onEdit(feedback);
              setFeedback("");
            }}
            disabled={!feedback.trim()}
          >
            Edit Template
          </Button>
          <Button 
            className="w-full bg-[#075E54] hover:bg-[#054c44]"
            onClick={() => onApprove(template)}
            disabled={submitting}
          >
            {submitting ? "Submitting…" : "Approve & Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
