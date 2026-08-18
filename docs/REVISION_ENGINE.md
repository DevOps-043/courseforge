# **Reporte de pruebas — Editor del Engine**

## **1\. Errores y estados del editor**

### **1.1. Error al guardar**

* En la parte superior derecha, junto a **“Ocultar panel”**, aparece el mensaje **“Error al guardar”**.  
* En la parte inferior aparece el aviso **“7 segmentos en una oración estimada”**.  
* Este último mensaje no debería marcarse como error, ya que no representa ningún problema.

### **1.2. Versión del documento**

* En la parte inferior falta mostrar la **“versión actual del documento”** entre paréntesis.  
* El texto **“if match reintentar reintente”** continúa apareciendo posteriormente durante el ensamblaje del vídeo.

### **1.3. Error después de generar el snapshot**

* Una vez generado el snapshot, aparece un **error interno al enviarlo al render del vídeo**.  
* El proceso queda detenido en ese estado y no parece recuperarse.

---

## **2\. Usabilidad del editor**

### **2.1. Manipulación de elementos**

La interacción con el editor no resulta intuitiva en comparación con editores convencionales.

Actualmente no queda claro:

* Cómo se arrastran los elementos.  
* Cómo se modifican las dimensiones del vídeo.  
* Cómo se editan directamente las propiedades.  
* En qué momento se guardan los cambios.

Sería conveniente simplificar la experiencia visual y reducir la cantidad de elementos heredados del panel anterior, ya que actualmente el editor se percibe demasiado cargado.

---

## **3\. Edición y animaciones**

### **3.1. Falta de herramienta para cortar vídeos**

No encuentro una herramienta que permita **cortar o dividir el vídeo**.

El problema viene de que actualmente el vídeo generado se trata como un **único clip completo**. Esto limita bastante las posibilidades de edición y animación.

### **3.2. Posible solución: generar por escenas**

Una alternativa sería que el vídeo no se genere como un único clip, sino **por escenas independientes**.

Esto permitiría:

* Editar cada escena por separado.  
* Cortar y reorganizar escenas.  
* Aplicar animaciones de forma independiente.  
* Tener mayor control sobre el resultado final.

Creo que esta aproximación podría simplificar bastante la edición.

---

## **4\. Reutilización del editor existente**

Queda una pregunta importante a nivel de arquitectura:

**¿Por qué estamos creando un editor propio en lugar de utilizar el mismo editor que ya existe en el preview de HeyGen?**

Antes de seguir desarrollando un editor independiente, sería importante entender:

* Qué limitaciones tiene el editor existente.  
* Qué funcionalidades necesitamos que actualmente no soporta.  
* Si técnicamente es posible reutilizarlo o adaptarlo.

### **Conclusión**

Los principales puntos a resolver son:

1. Corregir los estados y errores de guardado/render.  
2. Mostrar correctamente la versión actual del documento.  
3. Simplificar visualmente el editor.  
4. Hacer más intuitiva la manipulación y el guardado de propiedades.  
5. Definir cómo se va a resolver el corte y edición de vídeos.  
6. Evaluar si tiene sentido generar vídeos por escenas.  
7. Determinar si realmente es necesario mantener un editor propio o si podemos reutilizar el editor del preview de G y J.
