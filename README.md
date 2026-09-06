<img width="1280" height="640" alt="git (1)" src="https://github.com/user-attachments/assets/8920b256-2ba8-4988-b824-5351134eb4bd" />



# stick-shift Jockey


## Basic Details
### Team Name: shafeeh bin shakkir


### Team Members
- Team Lead: shafeeh bin shakkir - SCMS SCHOOL OF ENGINEERING AND TECHNOLOGY

### Project Description
makes listening to music more fun by adding gaming experience,visual experience,and even driving experience perhaps?

### The Problem (that doesn't exist)
people often just turn on their favourite music and just leaves it on and does other tasks 
leaving their favourite music attentionless and alone
### The Solution (that nobody asked for)
here, nuh uh they gotta pay full attention
they are supposed to maintain the music speed to be audible level by manualy shifting gears like in an actual manual trnasmission vehicle with a 5-speed gear box
gamepad/controller recommended for best experience

## Technical Details
### Technologies/Components Used
For Software:
Languages: HTML, CSS, JavaScript (ES modules)
Frameworks: none (vanilla front-end)
Libraries: Tailwind CSS (CDN)
Browser APIs: Web Audio API, Gamepad API, Canvas 2D, HTMLMediaElement / AudioBuffer
Tools: any static HTTP server (Live Server, npx serve, Python http.server, etc.) — no build step, no npm install



### Implementation
For Software:
# Installation
git clone https://github.com/shafeehshakkir/stick-shift_jockey.git
cd stick-shift_jockey

# Run
[commands]

### Project Documentation
For Software:

# Screenshots (Add at least 3)
<img width="1914" height="967" alt="image" src="https://github.com/user-attachments/assets/4aaf1b41-d3ef-4ab0-a45a-8828345d2649" />
this is the landing page also the dashboard which shows the song details and playback details

<img width="1914" height="967" alt="image" src="https://github.com/user-attachments/assets/c87de826-af86-430e-824e-284eb4eb8fea" />
this is the gamepad debugger

<img width="1914" height="967" alt="image" src="https://github.com/user-attachments/assets/b4217ef5-fa90-4c6a-90ff-858f86990bf8" />

hitting redline

# Diagrams
```mermaid
flowchart LR
  subgraph Input
    GP[Gamepad / Keyboard]
    UP[Load MP3]
  end

  subgraph Core["Stick-Shift Jockey"]
    GPJS[gamepad.js<br/>pedals · H-gate · ignition]
    ENG[engine.js<br/>RPM · gears · stall · redline<br/>virtualSpeed]
    AUD[audio.js<br/>playbackRate · reverse<br/>SFX · redline crush]
    UI[Dash UI<br/>tach · gear · song × · hints]
    SW[synthwave.js<br/>reactive backdrop]
  end

  UP --> AUD
  GP --> GPJS
  GPJS -->|clutch / throttle / gear| ENG
  ENG -->|virtualSpeed → rate| AUD
  ENG --> UI
  ENG --> SW
  AUD -->|heard rate / levels| UI
  AUD --> SW
```



### Project Demo
# Video

](https://drive.google.com/file/d/1srtDDI3dVz-bUKtkfAjVLRkaLJJyfjDz/view?usp=sharing)
basic guide of how to use it a controller/gamepad is recommended


---
Made with ❤️ at TinkerHub Useless Projects 

![Static Badge](https://img.shields.io/badge/TinkerHub-24?color=%23000000&link=https%3A%2F%2Fwww.tinkerhub.org%2F)
![Static Badge](https://img.shields.io/badge/UselessProjects--26-26?link=https%3A%2F%2Ftinkerhub.org%2Fevents%2F1M8ORET9A1%2Fuseless-projects-3.0)



