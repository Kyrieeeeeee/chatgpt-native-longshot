// Shared composer selectors. Gemini uses a Quill editor inside rich-textarea.
export const PROMPT_EDITOR='#prompt-textarea,textarea[data-testid="prompt-textarea"],form textarea,[contenteditable="true"][role="textbox"],rich-textarea [contenteditable="true"],.input-area textarea';
export function isPromptSendButton(button:HTMLButtonElement):boolean {
 const label=button.getAttribute('aria-label')??'';
 if(button.disabled||/stop|停止|中止/i.test(label))return false;
 return button.matches('[data-testid="send-button"],button[type="submit"],button.send-button,button[data-test-id="send-button"],[data-send-button]')||/^(发送|提交|Send prompt|Send message)/i.test(label);
}
