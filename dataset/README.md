# Dataset de rachaduras

## Pastas

| Pasta | Conteúdo |
| --- | --- |
| `fontes/` | Imagens com fissura e a anotação do Labelme ao lado (`.jpg` + `.json`), todas com o rótulo `rachadura` |
| `negativas/` | Imagens **sem** fissura (parede lisa, folhagem, papel, etc.). Ensinam o modelo a não marcar o que não é fissura |
| `pendentes/` | Imagens com fissura que **ainda não foram anotadas**. Não entram no treino até serem anotadas |
| `yolo/` | Dataset no formato do YOLO, gerado automaticamente. Não edite à mão |

## Como adicionar imagens

1. Anote no Labelme usando **sempre** o rótulo `rachadura`. Pode usar polígono, linha (linestrip) ou retângulo.
2. Fotos sem fissura não precisam de anotação: vão direto para `negativas/`.
3. Coloque os `.json` e as imagens numa pasta qualquer e rode, na raiz do projeto:

```powershell
backend\.venv\Scripts\python tools\build_dataset.py --importar C:\caminho\da\pasta
```

O script lê a imagem embutida no `.json`, ignora duplicadas e cópias, corrige rótulos com outro nome (números, maiúsculas, erros de digitação) e recria `yolo/` com a divisão treino/validação/teste. Imagens soltas sem anotação vão para `pendentes/`. Revise essa pasta: o que não tiver fissura deve ir para `negativas/`.

Para só recriar o `yolo/` depois de mexer nas pastas:

```powershell
backend\.venv\Scripts\python tools\build_dataset.py
```

## Treinar e avaliar

```powershell
backend\.venv\Scripts\yolo detect train data=dataset\yolo\dataset.yaml model=yolov8n.pt epochs=120 imgsz=640 flipud=0.5 degrees=15
backend\.venv\Scripts\yolo detect val model=runs\detect\train\weights\best.pt data=dataset\yolo\dataset.yaml split=test
```

O segundo comando mede precisão, revocação e mAP no conjunto de **teste**, com imagens que o modelo nunca viu no treino. São esses os números que valem para o TCC.
