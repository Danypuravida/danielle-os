# Central de desenvolvimento

A Central tem dois painéis: o aplicativo incorporado e os roteiros da equipe. O painel pessoal Desenvolvimento permanece separado.

## Leitura e geração

- `os_team_sources`: arquivos e transcrições privados da conta; entradas novas ficam pendentes até leitura real.
- `os_team_briefs`: versões imutáveis dos rascunhos de 1:1, Café e plano de ação. Revisões manuais ficam na mesma versão.
- `os_team_sync_state`: fontes configuradas, pessoas, estado da última leitura e identificação da automação.
- `os_team_merge_forms`: importação do Forms por chave estável, preservando preparação, respostas anteriores e outros dados do workspace. Só o processo de retaguarda pode executá-la.

A automação verifica as fontes de hora em hora. Novos textos podem ser colados ou importados como TXT/MD/VTT/SRT. PDF, DOCX e Google Docs são adicionados pelo link no Drive. A leitura usa os conectores autenticados; o navegador não recebe chaves de serviço ou credenciais do Google.

Rascunhos precisam separar observação, relato, hipótese e lacuna. Não confundir uma resposta do formulário com um encontro realizado ou uma intenção com uma ação concluída. Conversas de outra relação de liderança não pertencem ao histórico do liderado. O Café usa temas de processo, sem divulgar avaliações individuais. DISC é apoio a perguntas de desenvolvimento, não critério para diagnóstico, pontuação de capacidade ou decisão de carreira.

## Aplicativo incorporado

O iframe permanece montado ao alternar para os roteiros, para preservar o estado visual do aplicativo externo. A sessão do Danielle OS nunca é enviada por URL ou postMessage. Ao sair da conta, o iframe é descarregado.

O login Google só permite acesso visual. Troca bidirecional de dados exige código/API verificada do Apps Script. Nenhum endpoint foi inventado, nenhuma credencial é exposta e nenhuma comunicação com integrantes é enviada automaticamente. As configurações devem manter `script.connection = visual_only` até haver uma integração implementada e validada.
