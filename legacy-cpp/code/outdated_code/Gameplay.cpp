/*
 * File:   Gameplay.cpp
 * Author: Brian
 *
 * Created on June 17, 2012, 1:45 AM
 */

#include "Gameplay.h"
#include <string>
#include <iostream>
#include <libtcod/libtcod.hpp>


Gameplay::Gameplay(Pokemon* a, Renderer* hudrender) {
    HUDRender = hudrender;
    mapPosx = 1;
    mapPosy = 0;
    player = a;
    RNG = new TCODRandom();
    makeMap(3); //random int, not 3
    timer =0;
    HUD = new TCODConsole(42,24);
    currentTab = 0;
    menuTab.reserve(8);
    int x =0;
    //This for loop makes the menu tabs on the right hand side of the screen
    for(int p = 0; p<8;p++){
        if (p%2 ==0){   //this is the worst way to program this ever
              x = 15+x;
        }else{
        x++;
        }
        menuTab[p] = new TCODConsole(16,20);
        for (int z = 0; z<16; z++){
            menuTab[p]->setCharBackground(0,z, TCODColor(255,0,255));
            menuTab[p]->setCharBackground(1,z, TCODColor(255,0,255));
        }
        menuTab[p]->putCharEx(1,p*2+1,1461+x,TCODColor::white,TCODColor::black);
        menuTab[p]->printFrame(2,0,13,17, true);
        menuTab[p]->putCharEx(2,p*2+1,219,TCODColor(121,121,121),TCODColor::black);
        menuTab[p]->setKeyColor(TCODColor(255,0,255));
        TCODConsole::blit(menuTab[p],0,0,16,24,HUD,26,0, 1.0, 0);
    }
    HUDRender->init(&currentTab, &timer);

}

int Gameplay::playgame(){
        timer++;
        if (timer == 100){
            timer =0;
        }

        console();  //starting a new game
        int turn = playerTurn();
        if(turn == 0){
            //save game
            return 0;
        }
        if (turn ==1){

            timer = 0;
        }
        if (turn == 3){
            attackMode();//move in slot 1, slot 2, 3-6 "QWERDF"

        }
     //   if(playerTurn() == 2){
            //inventory
      //  }
        clear();
        //if play-> playerturn returns something else (when no keys are pressed, just continue to terrmap draw)
        compTurn();



}

void Gameplay::makeMap(int numberLayers){
    mapLayers.reserve(numberLayers);
    for(int p = 0; p<numberLayers;p++){
        MapGenerator gen = MapGenerator(numberLayers, p, RNG);
        MapManager* map = new MapManager(new TCODConsole(50,40));
        mapLayers[p] =  map;
        map->createTerrArray();//create all arrays
        map->makeNew();


    }
    for(int p = 0; p<numberLayers;p++){
        if (p != 0)
            mapLayers[p]->setFloorBelow(mapLayers[p--]);
        if (p != numberLayers)
            mapLayers[p]->setFloorAbove(mapLayers[p++]);
    }
    cycleMapLayer(0);
}

void Gameplay::cycleMapLayer(int newLayer){
    currentLayer = newLayer;
    Map = mapLayers[newLayer];


}

int Gameplay::playerTurn(){
    int temp = currentLayer;
    TCODConsole::blit(HUD,0,0,42,24,TCODConsole::root,0,0);

    player->draw(Map->returnConsoleMap());
        for(int x = 0; x<= temp;x++){
            cycleMapLayer(x);
            if(player->returnx()<=mapw/4 && player->returny()<=maph/4){
                TCODConsole::blit(Map->returnConsoleMap(),0,0,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy);
            }
            else if(player->returny()>=3*maph/4 && player->returnx()>=3*mapw/4){
                         TCODConsole::blit(Map->returnConsoleMap(),mapw/2,maph/2,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }
            else if(player->returny()>=3*maph/4 && player->returnx()<=mapw/4){
                         TCODConsole::blit(Map->returnConsoleMap(),0,maph/2,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }
            else if(player->returny()<=maph/4 && player->returnx()>=3*mapw/4){
                         TCODConsole::blit(Map->returnConsoleMap(),mapw/2,0,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }else if (player->returnx()<=mapw/4){
                TCODConsole::blit(Map->returnConsoleMap(),0,player->returny()-10,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy);
            }  else if ( player->returny()<=maph/4) {
                TCODConsole::blit(Map->returnConsoleMap(),player->returnx()-12,0,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }

            else if ( player->returny()>=3*maph/4 ){
                TCODConsole::blit(Map->returnConsoleMap(),player->returnx()-12,maph/2,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }
            else if ( player->returnx()>=3*mapw/4 ){
                TCODConsole::blit(Map->returnConsoleMap(),mapw/2,player->returny()-10,mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy,1.0,1.0);
            }

            else{TCODConsole::blit(Map->returnConsoleMap(),player->returnx()-12,player->returny()-10, mapw/2,maph/2,TCODConsole::root,mapPosx,mapPosy);
            }
        }

    return tryMove(Map);
}

void Gameplay::compTurn(){
    // if((Map->returnTerrain(player->returnx(), player->returny())->returnkey()).compare(0,5,"airr")==0)
      // cycleMapLayer(currentLayer-1);


    //check if player is standing on something or whatever
    //calculate ai();
        //this iterates through every actor on the map and lets the figure out what they want to do.
    //calculate speed();
        //each action will add to a priority int field.
        //it takes 5 seconds to move one square, so moving one is 5...
        //attacking takes 7-20 (20 being moves like solar beam), etc
        //sort all actors by priority....9
        //then put them into a queue.
        //pop each actor from a queue.1
        //then let them use
        //enemies attack



    animate();
    Map->terrToDraw(false, Map->FOV(player->returnx(),player->returny()) );
    //if player is standing on floor + ,compute fov below,
        //fov below first calls FOV on the current floor with a layer multiplier (1.5, round down?)
        //iterates through the FOV tiles and then finds those that have key string "airr"
        //then it saves those coordinates, then those coordinates are taken from the bottom floor and redrawn on the current
        //layer with a dark blue tint. theoretically, this would be recursive?
}
void Gameplay::animate(){
    HUDRender->animateSprite();
    if(timer%25 == 15) {
        player->setCurrentC(player->returncurrentc()+16);
    }

    if(timer%25 == 5){
        player->setCurrentC(player->returncurrentc()-16);
    }
}

void Gameplay::clear(){
    TCODConsole::flush();
    TCODConsole::root->clear(); //HUH?
    (Map->returnConsoleMap())->clear();
     TCODConsole::root->setDirty(26,0,16,18);
}

void Gameplay::console(){

    //DRAW MAP
    const char *thing = player->getName().c_str();
    HUD->setDefaultForeground(TCODColor::white);
    HUD->printFrame(0,20,42,4, true);


    //TCODConsole::root->printFrame(0,0, 42, 23, true, TCOD_BKGND_DARKEN, NULL);
    TCODConsole::blit(menuTab[currentTab],0,0,16,24,HUD,26,0, 1.0, 0);
    TCODConsole::setColorControl(TCOD_COLCTRL_1, TCODColor::red, TCODColor::black);
   // TCODConsole::root->printLeft(82,2,TCOD_BKGND_NONE,"D", TCOD_COLCTRL_1);



    //Implement toggled sidebars: inventory, party(allies), skills, help, gods, kills, view(enemies wary?), map
    //your status: health, bounty, experience, status effects, hunger, tiredness, running/crouching/stealthed, gold
    //simplify whenever possible

}

Gameplay::Gameplay(const Gameplay& orig) {
}

Gameplay::~Gameplay() {
    delete Map;
    delete gamething;
    delete player;
}

void Gameplay::attackMode(){
    //take move in slot
    //apply range, somehow calculate which coordinates are good
    //moves like agility, etc are autocasted.
    //redraw those tiles in red(or green or yellow)
    //get keys - cancel, or enter - or redirection to cardinal directions
    //probably show information... how many hits to kill which enemies? how much hp...
    //press space or something to find out that information

}

int Gameplay::tryMove(MapManager * map){
      TCOD_key_t key = TCODConsole::checkForKeypress(1);
      if ( key.vk == TCODK_KP6 || key.c == 'l' || key.vk == TCODK_RIGHT) {

          if (Map->isWalkable(player->returnx()+1,player->returny())){//check flying
                player->Pokemon::moveRight();
                return 1;
          }
          //else return a failmove
      }
      if ( key.vk == TCODK_KP4 ||  key.c == 'h' || key.vk == TCODK_LEFT) {
           if (Map->isWalkable(player->returnx()-1,player->returny())){
                player->Pokemon::moveLeft();
                return 1;
      }
      }
      if ( key.vk == TCODK_KP2 ||  key.c == 'j' || key.vk == TCODK_DOWN) {
          if (Map->isWalkable(player->returnx(),player->returny()+1)){
        player->Pokemon::moveDown();
          return 1;
          }
      }
      if ( key.vk == TCODK_KP8 ||  key.c == 'k' || key.vk == TCODK_UP) {
          if (Map->isWalkable(player->returnx(),player->returny()-1)){
            player->Pokemon::moveUp();
            return 1;
          }
      }

      if ( key.vk == TCODK_KP9 ||  key.c == 'u') {
        player->Actor::moveUpRight();
        return 1;
      }
      if ( key.vk == TCODK_KP7 ||  key.c == 'y') {
        player->Actor::moveUpLeft();
        return 1;
      }
      if ( key.vk == TCODK_KP1 ||  key.c == 'b') {
        player->Actor::moveDownLeft();
        return 1;
      }
      if ( key.vk == TCODK_KP3 ||  key.c == 'n') {
        player->Actor::moveDownRight();
        return 1;
      }

      if ( key.c == '>' ) {
//          if(mapLayers.size() > currentLayer+1)
            cycleMapLayer(currentLayer+1);
        return 1;
      }
    if ( key.c == '<' ) {
//          if(mapLayers.size() > currentLayer+1)
            cycleMapLayer(currentLayer-1);
            return 1;
      }
      if ( key.vk == TCODK_F11 ) {
              TCODConsole::setFullscreen(!TCODConsole::isFullscreen());
      }
      if ( key.vk ==TCODK_TAB ) {

              if (currentTab <= 6)
                currentTab++;
            else
                currentTab = 0;
      }


      if ( key.vk == TCODK_F10 ) {
              return 0; //exit
      }

      return 4;

}
