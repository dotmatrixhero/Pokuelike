#include "Renderer.h"
#include <iostream>

Renderer::Renderer()
{
    SDL_Init(SDL_INIT_EVERYTHING);
    TTF_Init();
//    freopen( "CON", "w", stdout );
//freopen( "CON", "w", stderr );
    firstRender = true;
    Font = TTF_OpenFont("Pokemon_GB.ttf", 18);
    message = NULL;
    SDL_Color textColor = { 255, 180, 255 };
    sprite1 = SDL_LoadBMP("sprites_frame_1.bmp");
    sprite2 = SDL_LoadBMP("sprites_frame_2.bmp");

    message = TTF_RenderText_Blended( Font, "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG", textColor );

}

void Renderer::init(int *currenttab, int *TIMER){
    currentTab = currenttab;
    timer = TIMER;

}

void Renderer::render(void *sdlSurface){
    dst = (SDL_Surface *)sdlSurface;

    firstRender=false;
    tabRender();
    SDL_Rect *srcRect = new SDL_Rect();
    srcRect->x = 0;
    srcRect->w = 1000;
    srcRect->h = 100;
    SDL_Rect *dstRect = new SDL_Rect();
    dstRect->x = 64;
    dstRect->w = 1000;
    dstRect->h = 1000;
    dstRect->y = 660;
    SDL_BlitSurface(message, srcRect, dst, dstRect );

}

void Renderer::animateSprite(){
    SDL_Rect *dstRect = new SDL_Rect();
    dstRect->x = 860;
    dstRect->w = 100;
    dstRect->h = 100;
    dstRect->y = 550;
    SDL_Rect *spriteRect = new SDL_Rect();
    spriteRect->x = 0;
    spriteRect->y = 0;
    spriteRect->w = 82;
    spriteRect->h = 82;

    if(*timer%40 > 15)
        SDL_BlitSurface(sprite1, spriteRect, dst, dstRect);
    else
        SDL_BlitSurface(sprite2, spriteRect, dst, dstRect);

}

void Renderer::printMenu(string words, int linesDown, bool erase){
    SDL_Rect *srcRect = new SDL_Rect();
    srcRect->x = 0;
    srcRect->w = 500;
    srcRect->h = 800;
    SDL_Rect *dstRect = new SDL_Rect();
    dstRect->x = 960;
    dstRect->w = 340;
    dstRect->h = 500;
    dstRect->y = 25 + (linesDown*20);

    SDL_Color textColor = { 255, 255, 255 };
    const char * c = words.c_str();
    SDL_Surface *src = TTF_RenderText_Blended( Font, c, textColor );
    SDL_BlitSurface(src, srcRect, dst, dstRect);


}
void Renderer::clearScreen(SDL_Rect *src){
//    SDL_FillRect(dst, src, SDL_MapRGBA(dst->format, 255, 0, 255,0 ));
//    SDL_SetColorKey(dst, SDL_SRCCOLORKEY, SDL_MapRGB(dst->format, 255, 0, 255));

    //SDL_FillRect(dst, src, SDL_MapRGBA(dst->format, 0, 0, 0, 0));


}

void Renderer::tabRender(){

    if (*currentTab == 0){
        printMenu("Inventory", 0, true);
    }

    if (*currentTab == 1){
        printMenu("Moves", 0, true);
    }

    if (*currentTab == 2){
        printMenu("Party", 0, true);
    }

    if (*currentTab == 3){
        printMenu("Environment", 0, true);
    }

    if (*currentTab == 4){
        printMenu("Map", 0, true);
    }

    if (*currentTab == 5){
        printMenu("Music", 0, true);
    }

    if (*currentTab == 6){
        printMenu("Identified", 0, true);
    }

    if (*currentTab == 7){
        printMenu("Help", 0, true);
    }

}
Renderer::~Renderer(){

}

