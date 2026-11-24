import type { ActivationFunction } from 'vscode-notebook-renderer';

export const activate: ActivationFunction = (context) => {
    return {
        renderOutputItem(outputItem, element) {
            // 1. 获取后端传过来的 JSON 数据
            const data = outputItem.json() as any[];

            if (!data || data.length === 0) {
                element.innerHTML = `<div style="padding: 8px; color: var(--vscode-descriptionForeground);">0 行数据</div>`;
                return;
            }

            const headers = Object.keys(data[0]);

            // 2. 编写高性能渲染逻辑（也可以在这里引入 Tabulator 或 Grid.js）
            let html = `
            <div style="max-height: 450px; overflow: auto; border: 1px solid var(--vscode-panel-border, #333);">
                <table style="width: 100%; border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px;">
                    <thead>
                        <tr style="background: var(--vscode-editor-inactiveSelectionBackground); position: sticky; top: 0;">
                            ${headers.map(h => `<th style="padding: 6px; border: 1px solid #333; text-align: left;">${h}</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(row => `
                            <tr>
                                ${headers.map(h => `<td style="padding: 6px; border: 1px solid #333; white-space: nowrap;">${row[h] ?? 'NULL'}</td>`).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>`;
            console.log('Rendering output item with data:', html);
            element.innerHTML = html;
        }
    };
};