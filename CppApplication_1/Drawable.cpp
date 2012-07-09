/* 
 * File:   Drawable.cpp
 * Author: Brian
 * 
 * Created on June 16, 2012, 9:29 PM
 */


#include "Drawable.h"
#include <string.h>
using namespace std;

Drawable::Drawable(int x, int y, int z, TCODColor fore, TCODColor back, bool trans, bool walk)
        : x(x),
        y(y),
        z(z),
        fore(fore),
        back(back),
        trans(trans),
        walk(walk)
{
}
Drawable::Drawable (int z, TCODColor fore, TCODColor back, bool trans, bool walk) 

        :z(z),
        fore(fore),
        back(back),
        trans(trans),
        walk(walk)
{
    x=0;//temp
    y=8;//temp
}


Drawable::Drawable(int x, int y, int z) 
        :x(x),
        y(y),
        z(z)
{}

void Drawable::draw(){
    TCODConsole::root->putCharEx(x,y,z,fore,back);
}

void Drawable::setX(int a){
    x=a;
}

void Drawable::setY(int b){
    y = b;
}
bool Drawable::moveRight(){
    if (x<76){ //implement using gameplay.mapPosx, etc. to define these values
        x++;
        return true;
    }
}

bool Drawable::moveDown(){
    if (y<53){
        y++;
        return true;   
    }
}

bool Drawable::moveLeft(){
    if (x>1){
        x--;
        return true;
    } 
}

bool Drawable::moveUp(){
    if (y>9){   
        y--;
        return true;
    }
}

bool Drawable::moveUpLeft(){
    if (x>1 && y>9){
        x--;
        y--;
        return true;
    } 
}

bool Drawable::moveDownLeft(){
    if (x>1 && y<53){
        x--;
        y++;
        return true;
    } 
}

bool Drawable::moveUpRight(){
    if (x<76 && y>9){ //implement using gameplay.mapPosx, etc. to define these values
        x++;
        y--;
        return true;
    }
}

bool Drawable::moveDownRight(){
    if (x<76 && y<53){ //implement using gameplay.mapPosx, etc. to define these values
        x++;
        y++;
        return true;
    }
}


int Drawable::returnx(){
   return x;
}

int Drawable::returny(){
   return y;
}

int Drawable::returnz(){
   return z;
}

TCODColor Drawable::returnfore(){
   return fore;
}

TCODColor Drawable::returnback(){
   return back;
}

bool Drawable::returntrans(){
    return trans;
}

bool Drawable::returnwalk(){
    return walk;
}
Drawable::~Drawable() {
}

