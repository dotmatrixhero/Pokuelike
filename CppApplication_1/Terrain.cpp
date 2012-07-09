/* 
 * File:   Terrain.cpp
 * Author: DAWT
 * 
 * Created on June 20, 2012, 1:50 PM
 */

#include "Terrain.h"

Terrain::Terrain(int a, int b, int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (a,b,c,d,e,f,g) {
    
}

Terrain::Terrain(int c, TCODColor d,TCODColor e,bool f,bool g) : Drawable (c,d,e,f,g) {
     x=0;//temp
     y=8;//temp

}

Terrain::~Terrain() {
}

