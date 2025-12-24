
from aiohttp import web
import logging
import os
from datetime import datetime
import os
import joblib
import numpy as np
import pandas as pd
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
import pydicom
import pydicom
from pydicom.dataset import Dataset, FileDataset, FileMetaDataset
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
art_path = r"C:\Users\ASUS\art_radiomics_features_20251119_190235 — копия.csv"
port_path = r"C:\Users\ASUS\port_radiomics_features_20251119_190235.csv"
out_path = r"C:\Users\ASUS\merged.csv"

art = pd.read_csv(art_path)
port = pd.read_csv(port_path)


def make_phase_columns(cols, prefix: str):
    new_cols = {}
    for c in cols:
        parts = c.split("_")
        camel = parts[0] + "".join(
            (p[:1].upper() + p[1:]) if p else "" for p in parts[1:]
        )
        new_cols[c] = prefix + camel
    return new_cols

art_renamed = art.rename(columns=make_phase_columns(art.columns, "art"))
port_renamed = port.rename(columns=make_phase_columns(port.columns, "port"))

merged = pd.concat([art_renamed, port_renamed], axis=1)

# 6. Сохраняем результат
merged.to_csv(out_path, index=False)
print(f"Готово, файл сохранён в: {out_path}")

# ВЕСА МОДЕЛИ 
PIPELINE_PATH = r"C:\Users\ASUS\112full_pipeline.pkl"

# путь к файлу с тестовой таблицей 
TEST_PATH = r"C:\Users\ASUS\merged.csv"
DATA_PATH = r"C:\Users\ASUS\общая таблица (все кроме кровотечений и внешней валидации) (1) - общая таблица (все кроме кровотечений и внешней валидации) (1).csv.csv" # в финальной версии не будет
print("PIPELINE_PATH:", PIPELINE_PATH)
print("TEST_PATH:", TEST_PATH)

# 1) загружаем пайплайн
pipe = joblib.load(PIPELINE_PATH)
var_sel   = pipe["var_sel"]
scaler    = pipe["scaler"]
feat_names = pipe["feat_names"]
to_drop_corr = pipe["to_drop_corr"]
keep_imp  = pipe["keep_imp"]
model     = pipe["model"]

# 2. Проверка переменных
train_df = pd.read_csv(DATA_PATH, low_memory=False)


mapping = {0: 0, 1: 1, 2: 1, 3: 1, 4: 1}
if "Label" in train_df.columns:
    train_df["Label"] = train_df["Label"].map(mapping)
    train_df = train_df[train_df["Label"].notna()].copy()
    train_df["Label"] = train_df["Label"].astype(int)
    train_df.sort_values("Label", inplace=True)
    X_train = train_df.drop(columns=["Label"])
else:
    X_train = train_df.copy()


X_train_num = X_train.apply(pd.to_numeric, errors="coerce")
train_means = X_train_num.mean()

# 3) загружаем тестовую таблицу
test_df = pd.read_csv(TEST_PATH, low_memory=False)

# если вдруг в тесте есть Label – удаляем
if "Label" in test_df.columns:
    test_df = test_df.drop(columns=["Label"])

# 4) добавляем недостающие признаки из train (заполняем средними train)
for col in X_train.columns:
    if col not in test_df.columns:
        test_df[col] = train_means[col]

# 5) удаляем лишние столбцы, которых не было при обучении,
#    и приводим порядок столбцов к обучающему
test_df = test_df[X_train.columns]

# 6) те же препроцедуры, что при обучении
X_new = test_df.apply(pd.to_numeric, errors="coerce")
X_new.fillna(X_new.mean(), inplace=True)

# 6.1) variance threshold
X_var_new = var_sel.transform(X_new)

# 6.2) масштабирование
X_scaled_new = scaler.transform(X_var_new)

# 6.3) отбор
df_var_new = pd.DataFrame(X_scaled_new, columns=feat_names)
if to_drop_corr:
    df_uncorr_new = df_var_new.drop(columns=to_drop_corr)
else:
    df_uncorr_new = df_var_new

# 6.4) отбор 
X_sel_new = df_uncorr_new[keep_imp]

# 7) предсказание вероятностей и классов
if hasattr(model, "predict_proba"):
    proba = model.predict_proba(X_sel_new.values)[:, 1]
elif hasattr(model, "decision_function"):
    scores = model.decision_function(X_sel_new.values)
    if scores.max() > scores.min():
        proba = (scores - scores.min()) / (scores.max() - scores.min())
    else:
        proba = np.full_like(scores, 0.5, dtype=float)
else:
    #запасной вариант, если у модели нет ни predict_proba, ни decision_function
    proba = model.predict(X_sel_new.values).astype(float)

pred = (proba >= 0.5).astype(int)

        # 8) сохраняем таблицу с предсказаниями
out_df = test_df.copy()
out_df["pred_proba"] = proba
out_df["pred_label"] = pred

        

out_path = r"C:\Users\ASUS\results.csv"
out_df.to_csv(out_path, index=False, encoding="utf-8-sig")

print("Инференс завершён.")
print("Результат сохранён в:", out_path)
print("Размер итоговой таблицы:", out_df.shape)
