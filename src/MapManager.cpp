/* 
 * File:   MapManager.cpp
 * Author: Brian
 * 
 * Created on June 17, 2012, 7:33 PM
 */

#include "MapManager.h"
#include <iostream>
#include <fstream>
#include <libtcod/libtcod.hpp>


using namespace std;

MapManager::MapManager() {
    
}


bool MapManager::isWalkable(int x, int y){
    for(int p = 0; p< mapw; p++){
        for (int q = 0; q <maph; q++){
               if (arrayWalk[x][y]){
                cout<<"is  walk";
                cout<<"\n";
               }
        }
    }
 
    
    return arrayWalk[x][y];
}

void MapManager::makeNew(){
    TCODMap *gameMap = new TCODMap(mapw,maph);
    gameMap->setProperties(50,45,true,true);
    //random gen and then write to file?
}

void MapManager::loadMap(/* get a file*/){
    //load the map from file, use iterator
}


void MapManager::createItemArray(){
    ifstream myReadFile;
    myReadFile.open("itemmaptest.txt");
    string input;
    int x=0;
    int y=0;
    while(myReadFile.good()){
        getline(myReadFile, input);
        if (input.empty()){
            cout<<"input #1 empty"; 
        break; }
        getline(myReadFile, input);
        cout<<input;
        cout<<"\n";
       
        //if (y==17){//THIS IS BAD PROGRAMMING, GOTTA FIX
        //    break;
       // }
        if (tilein.getItem(input) == NULL){ //ON THIS check, something happens...
            cout<< "output empty";
            break;
        }
      
        Item* copyThis = tilein.getItem(input);//copy
        cout<<copyThis->returnz();
        cout<<"\n";
        arrayItem[x][y] = new Item(x,y,copyThis->returnz(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk()); 
          if (x<mapw){
              if (y<maph){
                  y++;
              }
              if (y==maph){
                  y=0;
                  x++;
              }
       }
    }
    
    
    
   /*
    char foo[4];
    
    
    
    while(myReadFile>>input){
          
                   for(int q=0; q < 4; q++){
                        myReadFile>>foo[q];
                   }
                     
               
                   cerr << input  << endl;
        }*/
}


void MapManager::createTerrArray(){
    ifstream myReadFile;
    myReadFile.open("maptest2.txt");
    string input;
    while(myReadFile.good()){
        for (int x =0; x<mapw; x++){
        for (int y =0 ; y < maph; y++){    
                getline(myReadFile, input);
                if (input.empty()){
                        cout<<"input #1 empty"; 
                break; }
                getline(myReadFile, input);
                //cout<<input;
                //cout<<"\n";
      
                 if (tilein.getTerrain(input) == NULL){ //ON THIS check, something happens...
                        cout<< "output empty";
                 break;
                }
      
                Terrain* copyThis = tilein.getTerrain(input);//copy
                  cout<<copyThis->returnz();
                cout<<"\n";

             arrayTerrain[x][y] = new Terrain(x,y,copyThis->returnz(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk()); 
    
        }}
    }


}


void MapManager::createActoArray(){
    ifstream myReadFile;
    myReadFile.open("actomaptest.txt");
    string input;
    int x=0;
    int y=0;
    while(myReadFile.good()){
        getline(myReadFile, input);
        if (input.empty()){
            cout<<"input #1 empty"; 
        break; }
        getline(myReadFile, input);
        cout<<input;
        cout<<"\n";
      
        if (tilein.getActor(input) == NULL){ //ON THIS check, something happens...
            cout<< "output empty";
            break;
        }
      
        Actor* copyThis = tilein.getActor(input);//copy
        cout<<copyThis->returnz();
        cout<<"\n";
        arrayActors[x][y] = new Actor(x,y,copyThis->returnz(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk()); 
        arrayWalk[x][y] =  arrayActors[x][y]->returnwalk() or arrayWalk[x][y];
        if (x<mapw){
              if (y<maph){
                  y++;
              }
              if (y==maph){
                  y=0;
                  x++;
              }
       }
    }
    

}


void MapManager::createEffeArray(){
    ifstream myReadFile;
    myReadFile.open("effemaptest.txt");
    string input;
    int x=0;
    int y=0;
    while(myReadFile.good()){
        getline(myReadFile, input);
        if (input.empty()){
            cout<<"input #1 empty"; 
        break; }
        getline(myReadFile, input);
        cout<<input;
        cout<<"\n";
      
        if (tilein.getEffect(input) == NULL){ //ON THIS check, something happens...
            cout<< "output empty";
            break;
        }
      
        Effect* copyThis = tilein.getEffect(input);//copy
        cout<<copyThis->returnz();
        cout<<"\n";
        arrayEffects[x][y] = new Effect(x,y,copyThis->returnz(),copyThis->returnfore(),copyThis->returnback(), copyThis->returntrans(),copyThis->returnwalk()); 
          if (x<mapw){
              if (y<maph){
                  y++;
              }
              if (y==maph){
                  y=0;
                  x++;
              }
       }
    }
    

}


void MapManager::terrToDraw(){
    TCODColor myColor(24,64,255);
    TCODColor myColor2(24,64,0);
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayTerrain[x][y] != NULL){
                  Terrain* a = arrayTerrain[x][y]; 
                  TCODConsole::root->putCharEx(x+1,y+9,a->returnz(), myColor, myColor2);
                
                  arrayTrans[x][y] = new bool(a->returntrans());
                  arrayWalk[x][y] = (a->returnwalk());
        
    //   if terrain is not walkable, throw coordinates into an array called.....arrayNotWalk
    //   if terrain is not viewable throw coordinates into an array called....arrayNotTrans
       
    
    //(1,1,1, myColor, myColor2, true, true);
              }
          }
          
    }    
}


void MapManager::itemToDraw(){
    TCODColor myColor(24,64,255);
    TCODColor myColor2(24,64,0);
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayItem[x][y] != NULL){
                  Item* a = arrayItem[x][y]; 
                  TCODConsole::root->putCharEx(a->returnx()+1,a->returny()+9,a->returnz(), myColor, myColor2);
    //   if terrain is not walkable, throw coordinates into an array called.....arrayNotWalk
    //   if terrain is not viewable throw coordinates into an array called....arrayNotTrans
       
    
    //(1,1,1, myColor, myColor2, true, true);
              }}}    
}


void MapManager::actoToDraw(){
    TCODColor myColor(24,64,255);
    TCODColor myColor2(24,64,0);
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayActors [x][y] != NULL){
                  Actor* a = arrayActors[x][y]; 
                  TCODConsole::root->putCharEx(a->returnx()+1,a->returny()+9,a->returnz(), myColor, myColor2);
    //   if terrain is not walkable, throw coordinates into an array called.....arrayNotWalk
    //   if terrain is not viewable throw coordinates into an array called....arrayNotTrans
       
    
    //(1,1,1, myColor, myColor2, true, true);
              }}}    
}



void MapManager::effeToDraw(){
    TCODColor myColor(24,64,255);
    TCODColor myColor2(24,64,0);
    for (int x =0; x<mapw; x++){
          for(int y =0 ; y < maph; y++){
              if (arrayEffects[x][y] != NULL){
                  Effect* a = arrayEffects[x][y]; 
                  TCODConsole::root->putCharEx(a->returnx()+1,a->returny()+9,a->returnz(), myColor, myColor2);
    //   if terrain is not walkable, throw coordinates into an array called.....arrayNotWalk
    //   if terrain is not viewable throw coordinates into an array called....arrayNotTrans
       
    
    //(1,1,1, myColor, myColor2, true, true);
              }}}    
}


MapManager::MapManager(const MapManager& orig) {
}

MapManager::~MapManager() {
    delete gameMap;
}

